import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { BidService } from './bid.service';

@Controller('bids')
export class BidController {
  constructor(private readonly bidService: BidService) {}

  @Post()
  async placeBid(
    @Body() body: { userId: number; auctionId: number; amount: number },
  ) {
    return this.bidService.placeBid(body);
  }

  @Get('auction/:auctionId')
  async getBidsByAuction(@Param('auctionId') auctionId: string) {
    return this.bidService.getBidsByAuction(Number(auctionId));
  }

  @Get('user/:userId')
  async getBidsByUser(@Param('userId') userId: string) {
    return this.bidService.getBidsByUser(Number(userId));
  }
}
