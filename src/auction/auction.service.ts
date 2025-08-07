import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AuctionService {
  constructor(private prisma: PrismaService) {}

  async createAuction(data: {
    carId: string;
    startTime: Date;
    endTime: Date;
    startingBid: number;
    status?: string;
  }) {
    return this.prisma.auction.create({
      data: {
        carId: data.carId,
        startTime: data.startTime,
        endTime: data.endTime,
        startingBid: data.startingBid,
        status: data.status || 'active',
      },
    });
  }

  async getAllAuctions() {
    return this.prisma.auction.findMany({
      include: { bids: true, winner: true },
    });
  }

  async getAuctionById(id: number) {
    return this.prisma.auction.findUnique({
      where: { id },
      include: { bids: true, winner: true },
    });
  }
}
