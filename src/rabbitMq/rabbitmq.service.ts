import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { connect, Connection, Channel, Options, Replies } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private conn!: Connection;
  private ch!: Channel;

  readonly url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

  // Exchanges
  readonly EX_BIDS = 'bids'; // direct (bid processing)
  readonly EX_DLX = 'bids.dlx'; // direct (dead letters)
  readonly EX_NOTIFY = 'notify'; // fanout (notifications)
  readonly EX_AUDIT = 'audit'; // fanout (audit)

  // Queues
  readonly Q_BIDS_PROCESS = 'bids.process'; // Bid Processing Queue
  readonly Q_BIDS_DLQ = 'bids.dlq'; // Dead Letter Queue
  readonly Q_NOTIFY_USER = 'notify.user'; // Notification Queue
  readonly Q_AUDIT_LOG = 'audit.log'; // Audit Queue

  // Routing keys
  readonly RK_BID_PLACE = 'bid.place';
  readonly RK_DEAD = 'bid.dead';

  get channel(): Channel {
    if (!this.ch) throw new Error('RabbitMQ channel not ready');
    return this.ch;
  }

  async onModuleInit() {
    this.conn = await connect(this.url);
    this.ch = await this.conn.createChannel();
    await this.ch.prefetch(10);

    // Exchanges
    await this.ch.assertExchange(this.EX_BIDS, 'direct', { durable: true });
    await this.ch.assertExchange(this.EX_DLX, 'direct', { durable: true });
    await this.ch.assertExchange(this.EX_NOTIFY, 'fanout', { durable: true });
    await this.ch.assertExchange(this.EX_AUDIT, 'fanout', { durable: true });

    // DLQ + binding
    await this.ch.assertQueue(this.Q_BIDS_DLQ, { durable: true });
    await this.ch.bindQueue(this.Q_BIDS_DLQ, this.EX_DLX, this.RK_DEAD);

    // Processing queue with DLX
    await this.ch.assertQueue(this.Q_BIDS_PROCESS, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.EX_DLX,
        'x-dead-letter-routing-key': this.RK_DEAD,
      },
    });
    await this.ch.bindQueue(
      this.Q_BIDS_PROCESS,
      this.EX_BIDS,
      this.RK_BID_PLACE,
    );

    // Demo consumers for notify/audit (so messages have somewhere to land)
    await this.ch.assertQueue(this.Q_NOTIFY_USER, { durable: true });
    await this.ch.bindQueue(this.Q_NOTIFY_USER, this.EX_NOTIFY, '');

    await this.ch.assertQueue(this.Q_AUDIT_LOG, { durable: true });
    await this.ch.bindQueue(this.Q_AUDIT_LOG, this.EX_AUDIT, '');

    console.log('[RabbitMQ] Exchanges/Queues ready');
  }

  async onModuleDestroy() {
    try {
      await this.ch?.close();
    } catch {}
    try {
      await this.conn?.close();
    } catch {}
  }

  publish(
    exchange: string,
    routingKey: string,
    message: unknown,
    options?: Options.Publish,
  ) {
    const buf = Buffer.from(JSON.stringify(message));
    return this.channel.publish(exchange, routingKey, buf, {
      persistent: true,
      ...(options || {}),
    });
  }

  async consume(
    queue: string,
    handler: (msg: {
      content: Buffer;
      properties: any;
      raw: any;
    }) => Promise<void> | void,
  ): Promise<Replies.Consume> {
    return this.channel.consume(
      queue,
      async (m) => {
        if (!m) return;
        try {
          await handler({
            content: m.content,
            properties: m.properties,
            raw: m,
          });
          this.channel.ack(m); // success
        } catch (e) {
          // fail → dead-letter (no requeue)
          this.channel.nack(m, false, false);
        }
      },
      { noAck: false },
    );
  }

  ack(m: any) {
    this.channel.ack(m);
  }
  nack(m: any, requeue = false) {
    this.channel.nack(m, false, requeue);
  }
}
