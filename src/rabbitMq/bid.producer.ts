import { Injectable } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';

@Injectable()
export class BidProducer {
  constructor(private readonly mq: RabbitMQService) {}

  publishBid(payload: { auctionId: number; userId: number; amount: number }) {
    return this.mq.publish(this.mq.EX_BIDS, this.mq.RK_BID_PLACE, {
      ...payload,
      ts: Date.now(),
    });
  }
}
