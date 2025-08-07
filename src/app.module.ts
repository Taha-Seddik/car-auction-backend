import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

import { UserService } from './user/user.service';
import { UserController } from './user/user.controller';

import { AuctionService } from './auction/auction.service';
import { AuctionController } from './auction/auction.controller';

import { BidService } from './bid/bid.service';
import { BidController } from './bid/bid.controller';

@Module({
  imports: [],
  controllers: [UserController, AuctionController, BidController],
  providers: [PrismaService, UserService, AuctionService, BidService],
})
export class AppModule {}
