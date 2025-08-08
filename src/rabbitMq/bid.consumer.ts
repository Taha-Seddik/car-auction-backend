import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { AuctionService } from '../auction/auction.service';
import { Replies } from 'amqplib';

type BidMsg = { auctionId: number; userId: number; amount: number; ts: number };

const MAX_RETRIES = 3;

@Injectable()
export class BidConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BidConsumer.name);
  private consumerTags: string[] = [];

  constructor(
    private readonly mq: RabbitMQService,
    private readonly auctionService: AuctionService,
  ) {}

  // Start AFTER all providers finished onModuleInit (including RabbitMQService)
  async onApplicationBootstrap() {
    // consume processing queue
    const c1: Replies.Consume = await this.mq.consume(
      this.mq.Q_BIDS_PROCESS,
      async ({ content, properties }) => {
        const msg = JSON.parse(content.toString()) as BidMsg;
        const retry = Number(properties?.headers?.['x-retry'] ?? 0);

        try {
          await this.auctionService.placeBidTx({
            auctionId: Number(msg.auctionId),
            userId: Number(msg.userId),
            amount: Number(msg.amount),
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
          // ACK is done by RabbitMQService after handler returns
        } catch (err: any) {
          this.logger.warn(
            `Bid failed (retry=${retry}): ${err?.message || err}`,
          );

          if (retry < MAX_RETRIES) {
            // requeue a fresh copy with incremented retry header, ACK original
            this.mq.publish(
              this.mq.EX_BIDS,
              this.mq.RK_BID_PLACE,
              { ...msg },
              { headers: { 'x-retry': retry + 1 } },
            );
            return; // success path → original msg gets ACKed by service
          }

          // too many retries -> throw -> NACK(no requeue) -> DLQ
          throw err;
        }
      },
    );
    this.consumerTags.push(c1.consumerTag);

    // observe DLQ for failures
    const c2: Replies.Consume = await this.mq.consume(
      this.mq.Q_BIDS_DLQ,
      async ({ content }) => {
        this.logger.error(`DLQ: ${content.toString()}`);
      },
    );
    this.consumerTags.push(c2.consumerTag);

    this.logger.log('BidConsumer listening');
  }

  // Graceful shutdown: cancel consumers so the channel can close cleanly
  async onModuleDestroy() {
    for (const tag of this.consumerTags) {
      try {
        await this.mq.channel.cancel(tag);
      } catch (e) {
        this.logger.debug(`Cancel consumer ${tag} failed: ${e}`);
      }
    }
  }
}
