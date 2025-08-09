// src/auction/auction-closer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuctionCloserService {
  private readonly logger = new Logger(AuctionCloserService.name);
  private readonly BATCH = 20; // close up to 20 per tick

  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // runs every 5 seconds
  @Cron('*/5 * * * * *')
  async closeExpiredAuctions() {
    const now = new Date();

    // find a small batch of expired "active" auctions
    const toClose = await this.prisma.auction.findMany({
      where: { status: 'active', endTime: { lte: now } },
      select: { id: true },
      orderBy: { endTime: 'asc' },
      take: this.BATCH,
    });

    for (const { id } of toClose) {
      try {
        // claim + close in a transaction so only one instance processes it
        const updated = await this.prisma.$transaction(async (tx) => {
          // claim: flip active->closing; if count==0 someone else claimed it
          const claim = await tx.auction.updateMany({
            where: { id, status: 'active' },
            data: { status: 'closing' },
          });
          if (claim.count === 0) return null;

          const top = await tx.bid.findFirst({
            where: { auctionId: id },
            orderBy: { amount: 'desc' },
          });

          return tx.auction.update({
            where: { id },
            data: {
              status: 'completed',
              winnerId: top?.userId ?? null,
              currentHighestBid: top?.amount ?? undefined,
            },
          });
        });

        if (updated) {
          this.logger.log(
            `[CLOSER] Closed auction ${updated.id} winner=${updated.winnerId ?? 'none'} amount=${updated.currentHighestBid ?? 'n/a'}`
          );

          // notify clients in that room (your gateway already relays this)
          await this.redis.pub.publish(
            this.redis.channel(updated.id),
            JSON.stringify({
              type: 'auctionEnd',
              auctionId: updated.id,
              winnerId: updated.winnerId ?? null,
              amount: updated.currentHighestBid ?? null,
              timestamp: Date.now(),
            }),
          );
        }
      } catch (e: any) {
        this.logger.warn(`[CLOSER] Failed to close auction ${id}: ${e.message || e}`);
      }
    }
  }
}
