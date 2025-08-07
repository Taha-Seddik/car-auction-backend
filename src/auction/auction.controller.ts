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
    return this.auctionService.createAuction(body);
  }

  @Get()
  async getAllAuctions() {
    return this.auctionService.getAllAuctions();
  }

  @Get(':id')
  async getAuctionById(@Param('id') id: string) {
    return this.auctionService.getAuctionById(Number(id));
  }
}
