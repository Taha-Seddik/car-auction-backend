import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { UserService } from './user/user.service';
import { UserController } from './user/user.controller';
import { AuctionService } from './auction/auction.service';
import { AuctionController } from './auction/auction.controller';
import { BidService } from './bid/bid.service';
import { BidController } from './bid/bid.controller';
import { AuctionGateway } from './auction/auction.gateway';
import { RedisService } from './redis/redis.service';
import { BidConsumer } from './rabbitMq/bid.consumer';
import { BidProducer } from './rabbitMq/bid.producer';
import { RabbitMQService } from './rabbitMq/rabbitmq.service';
import { ScheduleModule } from '@nestjs/schedule';
import { AuctionCloserService } from './auction/auction-closer.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [UserController, AuctionController, BidController],
  providers: [
    PrismaService,
    UserService,
    AuctionService,
    BidService,
    RedisService,
    AuctionGateway,
    RabbitMQService,
    BidProducer,
    BidConsumer,
    AuctionCloserService
  ],
})
export class AppModule {}
