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

  async createAuction(input: {
    carId: string;
    minutes: number;
    startingBid: number;
  }) {
    const now = new Date();
    const end = new Date(now.getTime() + input.minutes * 60_000);

    const auction = await this.prisma.auction.create({
      data: {
        carId: input.carId,
        startTime: now,
        endTime: end,
        startingBid: input.startingBid,
        status: 'active',
      },
    });

    return auction;
  }

  async placeBidTx(params: {
    auctionId: number;
    userId: number;
    amount: number;
  }) {
    const { auctionId, userId, amount } = params;

    // 1) Short, DB-only transaction
    const bid = await this.prisma.$transaction(
      async (tx) => {
        // lock the row; second writer waits here until first commits
        const [auction] = await tx.$queryRaw<
          Array<{
            id: number;
            currentHighestBid: number | null;
            startingBid: number;
            endTime: Date;
            status: string;
          }>
        >`
          SELECT id, "currentHighestBid", "startingBid", "endTime", "status"
          FROM "Auction"
          WHERE id = ${auctionId}
          FOR UPDATE
        `;

        if (!auction) throw new BadRequestException('Auction not found');
        if (auction.status !== 'active')
          throw new BadRequestException('Auction not active');
        if (new Date(auction.endTime).getTime() <= Date.now())
          throw new BadRequestException('Auction already ended');

        // must be at least previous + 1
        const minAllowed =
          (auction.currentHighestBid ?? auction.startingBid) + 1;
        if (amount < minAllowed)
          throw new BadRequestException(`Bid must be >= ${minAllowed}`);

        // write bid
        const created = await tx.bid.create({
          data: { userId, auctionId, amount },
        });

        // update highest
        await tx.auction.update({
          where: { id: auctionId },
          data: { currentHighestBid: amount },
        });

        return created;
      },
      {
        isolationLevel: 'ReadCommitted', // fewer serialization conflicts than 'Serializable'
        timeout: 10_000, // give a bit more room under lock contention
      },
    );

    // 2) After commit: cache + pub/sub (non-blocking for the DB tx)
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
