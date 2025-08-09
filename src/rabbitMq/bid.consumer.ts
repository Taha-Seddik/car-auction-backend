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
    const c1: Replies.Consume = await this.mq.consume(
      this.mq.Q_BIDS_PROCESS,
      async ({ content, properties }) => {
        const msg = JSON.parse(content.toString()) as BidMsg;
        const retry = Number(properties?.headers?.['x-retry'] ?? 0);

        // log when a bid message is received
        this.logger.log(
          `[BID:RECV] a=${msg.auctionId} u=${msg.userId} amt=${msg.amount} retry=${retry}`,
        );

        try {
          await this.auctionService.placeBidTx({
            auctionId: Number(msg.auctionId),
            userId: Number(msg.userId),
            amount: Number(msg.amount),
          });

          // log accepted
          this.logger.log(
            `[BID:ACCEPTED] a=${msg.auctionId} u=${msg.userId} amt=${msg.amount}`,
          );

          // notify + audit
          this.mq.publish(this.mq.EX_NOTIFY, '', {
            type: 'bidUpdate',
            auctionId: msg.auctionId,
            userId: msg.userId,
            amount: msg.amount,
            ts: Date.now(),
          });
          this.mq.publish(this.mq.EX_AUDIT, '', {
            type: 'bid.processed',
            ...msg,
            processedAt: Date.now(),
          });
          // ack happens in RabbitMQService wrapper
        } catch (err: any) {
          const reason = err?.message || String(err);
          this.logger.warn(
            `[BID:FAIL] a=${msg.auctionId} u=${msg.userId} amt=${msg.amount} retry=${retry} reason="${reason}"`,
          );

          if (retry < MAX_RETRIES) {
            // NEW: log requeue
            this.logger.warn(
              `[BID:REQUEUE] a=${msg.auctionId} u=${msg.userId} amt=${msg.amount} nextRetry=${retry + 1}`,
            );
            this.mq.publish(
              this.mq.EX_BIDS,
              this.mq.RK_BID_PLACE,
              { ...msg },
              { headers: { 'x-retry': retry + 1 } },
            );
            return; // original will be acked by wrapper
          }

          // NEW: log final reject before DLQ
          this.logger.error(
            `[BID:REJECT_FINAL] a=${msg.auctionId} u=${msg.userId} amt=${msg.amount} reason="${reason}"`,
          );
          throw err; // wrapper will nack(no requeue) => DLQ
        }
      },
    );
    this.consumerTags.push(c1.consumerTag);

    // DLQ observer (log only)
    const c2: Replies.Consume = await this.mq.consume(
      this.mq.Q_BIDS_DLQ,
      async ({ content }) => {
        this.logger.error(`[DLQ:MSG] ${content.toString()}`);
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
