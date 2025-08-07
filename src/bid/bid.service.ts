import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BidService {
  constructor(private prisma: PrismaService) {}

  async placeBid(data: {
    userId: number;
    auctionId: number;
    amount: number;
  }) {
    // In a real app, you'd check that amount > currentHighestBid, auction is active, etc.
    return this.prisma.bid.create({
      data: {
        userId: data.userId,
        auctionId: data.auctionId,
        amount: data.amount,
      },
    });
  }

  async getBidsByAuction(auctionId: number) {
    return this.prisma.bid.findMany({
      where: { auctionId },
      include: { user: true },
      orderBy: { timestamp: 'desc' },
    });
  }

  async getBidsByUser(userId: number) {
    return this.prisma.bid.findMany({
      where: { userId },
      include: { auction: true },
      orderBy: { timestamp: 'desc' },
    });
  }
}
