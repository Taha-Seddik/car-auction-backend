import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { AuctionService } from '../auction/auction.service';

type BidMsg = { auctionId: number; userId: number; amount: number; ts: number };

const MAX_RETRIES = 3;

@Injectable()
export class BidConsumer implements OnModuleInit {
  private readonly logger = new Logger(BidConsumer.name);

  constructor(
    private readonly mq: RabbitMQService,
    private readonly auctionService: AuctionService,
  ) {}

  async onModuleInit() {
    // consume processing queue
    await this.mq.consume(this.mq.Q_BIDS_PROCESS, async ({ content, properties, raw }) => {
      const msg = JSON.parse(content.toString()) as BidMsg;
      const retry = Number(properties?.headers?.['x-retry'] ?? 0);

      try {
        await this.auctionService.placeBidTx({
          auctionId: +msg.auctionId,
          userId: +msg.userId,
          amount: +msg.amount,
        });

        // notify (fanout)
        this.mq.publish(this.mq.EX_NOTIFY, '', {
          type: 'bidUpdate',
          auctionId: msg.auctionId,
          userId: msg.userId,
          amount: msg.amount,
          ts: Date.now(),
        });

        // audit (fanout)
        this.mq.publish(this.mq.EX_AUDIT, '', {
          type: 'bid.processed',
          ...msg,
          processedAt: Date.now(),
        });

        // ACK happens via RabbitMQService after handler returns
      } catch (err: any) {
        this.logger.warn(`Bid failed (retry=${retry}): ${err?.message || err}`);

        if (retry < MAX_RETRIES) {
          // requeue a fresh copy with incremented retry header, ACK original
          this.mq.publish(this.mq.EX_BIDS, this.mq.RK_BID_PLACE, { ...msg }, {
            headers: { 'x-retry': retry + 1 },
          });
          return; // do not throw -> success path ACKs original
        }

        // too many retries -> throw -> NACK(no requeue) -> DLQ
        throw err;
      }
    });

    //  observe DLQ so you can see failures in logs
    await this.mq.consume(this.mq.Q_BIDS_DLQ, async ({ content }) => {
      this.logger.error(`DLQ: ${content.toString()}`);
    });

    this.logger.log('BidConsumer listening');
  }
}
