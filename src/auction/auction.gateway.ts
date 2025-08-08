import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuctionService } from './auction.service';
import { RedisService } from '../redis/redis.service';
import { BidProducer } from 'src/rabbitMq/bid.producer';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class AuctionGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private auctionService: AuctionService,
    private redis: RedisService,
    private bidProducer: BidProducer,
  ) {}

  afterInit() {}
  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('joinAuction')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: number },
  ) {
    const auctionId = Number(payload.auctionId);
    const room = `auction:${auctionId}`;
    client.join(room);

    // subscribe to Redis channel for this auction
    const channel = this.redis.channel(auctionId);

    const handler = (message: string, chan: string) => {
      if (chan !== channel) return;
      const evt = JSON.parse(message);
      if (evt.type === 'bidUpdate') {
        this.server.to(room).emit('bidUpdate', {
          amount: evt.amount,
          userId: evt.userId,
          ts: evt.timestamp,
        });
      } else if (evt.type === 'auctionEnd') {
        this.server.to(room).emit('auctionEnd', {
          winnerId: evt.winnerId,
          amount: evt.amount,
        });
      }
    };

    if (!(this as any)[channel]) {
      (this as any)[channel] = true;
      this.redis.sub.subscribe(channel);
      this.redis.sub.on('message', handler);
    }

    // send current price to this client
    const current = await this.auctionService.getCurrentHighest(auctionId);
    client.emit('currentHighest', { amount: current });
    return { joined: true, room };
  }

  @SubscribeMessage('placeBid')
  async onPlaceBid(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { auctionId: number; userId: number; amount: number },
  ) {
    // validate + normalize inputs (cheap guard)
    const auctionId = Number(payload.auctionId);
    const userId = Number(payload.userId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(auctionId) || !Number.isFinite(userId) || !Number.isFinite(amount)) {
      client.emit('bidError', { message: 'Invalid bid payload' });
      return { ok: false };
    }

    try {
      // enqueue to RabbitMQ (async, reliable)
      await this.bidProducer.publishBid({ auctionId, userId, amount });

      // immediate feedback to the bidder; the actual room broadcast happens
      // after the consumer processes and publishes via Redis
      client.emit('bidQueued', { ok: true });
      return { ok: true };
    } catch (err: any) {
      // if publish fails 
      client.emit('bidError', { message: err?.message ?? 'Failed to queue bid' });
      return { ok: false, error: 'Failed to queue bid' };
    }
  }

  @SubscribeMessage('endAuction')
  async onEnd(@MessageBody() payload: { auctionId: number }) {
    // keep direct call for now; you can also queue this if you want
    const updated = await this.auctionService.endAuction(Number(payload.auctionId));
    return {
      status: updated.status,
      winnerId: updated.winnerId,
      amount: updated.currentHighestBid,
    };
  }
}
