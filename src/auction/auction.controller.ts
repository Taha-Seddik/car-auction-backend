import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { CreateAuctionDto } from 'src/dto/create-auction.dto';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  async create(@Body() body: CreateAuctionDto) {
    const minutes = Number(body.minutes ?? 30);
    const startingBid = Number(body.startingBid ?? 1000);
    const carId = body.carId || 'car-generated';

    const auction = await this.auctionService.createAuction({
      carId,
      minutes,
      startingBid,
    });
    return auction; // { id, carId, startTime, endTime, ... }
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
