import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuctionService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  getAll() {
    return this.prisma.auction.findMany({
      include: { bids: true, winner: true },
    });
  }

  getById(id: number) {
    return this.prisma.auction.findUnique({
      where: { id },
      include: { bids: true, winner: true },
    });
  }

  create(data: {
    carId: string;
    startTime: Date;
    endTime: Date;
    startingBid: number;
    status?: string;
  }) {
    return this.prisma.auction.create({
      data: { ...data, status: data.status ?? 'active' },
    });
  }

  async placeBidTx(params: {
    auctionId: number;
    userId: number;
    amount: number;
  }) {
    const { auctionId, userId, amount } = params;

    return this.prisma.$transaction(
      async (tx) => {
        // lock the auction row so two writers can't update at once
        const [auction] = await tx.$queryRaw<
          Array<{
            id: number;
            currentHighestBid: number | null;
            startingBid: number;
            endTime: Date;
            status: string;
          }>
        >`SELECT id, "currentHighestBid", "startingBid", "endTime", "status"
        FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;

        if (!auction) throw new BadRequestException('Auction not found');
        if (auction.status !== 'active')
          throw new BadRequestException('Auction not active');
        if (new Date(auction.endTime).getTime() <= Date.now())
          throw new BadRequestException('Auction already ended');

        // new bid must be >= last + 1
        const minAllowed =
          (auction.currentHighestBid ?? auction.startingBid) + 1;
        if (amount < minAllowed)
          throw new BadRequestException(`Bid must be >= ${minAllowed}`);

        // persist bid
        const bid = await tx.bid.create({
          data: { userId, auctionId, amount },
        });

        // update auction's currentHighestBid
        await tx.auction.update({
          where: { id: auctionId },
          data: { currentHighestBid: amount },
        });

        // cache & pub/sub
        await this.redis.cache.set(
          this.redis.auctionKey(auctionId),
          String(amount),
        );
        await this.redis.pub.publish(
          this.redis.channel(auctionId),
          JSON.stringify({
            type: 'bidUpdate',
            auctionId,
            amount,
            userId,
            timestamp: Date.now(),
          }),
        );

        return bid;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async endAuction(auctionId: number) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.auction.findUnique({
        where: { id: auctionId },
        include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
      });
      if (!auction) throw new BadRequestException('Auction not found');
      if (auction.status !== 'active') return auction;

      const top = auction.bids[0];
      const updated = await tx.auction.update({
        where: { id: auctionId },
        data: {
          status: 'completed',
          winnerId: top?.userId ?? null,
          currentHighestBid: top?.amount ?? auction.currentHighestBid,
        },
      });

      await this.redis.pub.publish(
        this.redis.channel(auctionId),
        JSON.stringify({
          type: 'auctionEnd',
          auctionId,
          winnerId: updated.winnerId ?? null,
          amount: updated.currentHighestBid ?? null,
          timestamp: Date.now(),
        }),
      );

      return updated;
    });
  }

  // Read current price / Redis cache
  async getCurrentHighest(auctionId: number) {
    const cached = await this.redis.cache.get(this.redis.auctionKey(auctionId));
    if (cached) return Number(cached);
    const a = await this.prisma.auction.findUnique({
      where: { id: auctionId },
    });
    return a?.currentHighestBid ?? a?.startingBid ?? 0;
  }
}
