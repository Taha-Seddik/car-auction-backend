import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { AuctionService } from './auction.service';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  async createAuction(@Body() body: {
    carId: string;
    startTime: Date;
    endTime: Date;
    startingBid: number;
    status?: string;
  }) {
    return this.auctionService.create(body);
  }

  @Get()
  async getAllAuctions() {
    return this.auctionService.getAll();
  }

  @Get(':id')
  async getAuctionById(@Param('id') id: string) {
    return this.auctionService.getById(Number(id));
  }
}
