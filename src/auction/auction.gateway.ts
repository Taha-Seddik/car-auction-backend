import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayInit, OnGatewayDisconnect, ConnectedSocket, MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuctionService } from './auction.service';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class AuctionGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  constructor(private auctionService: AuctionService, private redis: RedisService) {}

  afterInit() {}
  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('joinAuction')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: { auctionId: number }) {
    const auctionId = Number(payload.auctionId);
    const room = `auction:${auctionId}`;
    client.join(room);

    // receive updates for this auction from Redis
    const channel = this.redis.channel(auctionId);

    const handler = (message: string, chan: string) => {
      if (chan !== channel) return;
      const evt = JSON.parse(message);
      if (evt.type === 'bidUpdate') {
        this.server.to(room).emit('bidUpdate', { amount: evt.amount, userId: evt.userId, ts: evt.timestamp });
      } else if (evt.type === 'auctionEnd') {
        this.server.to(room).emit('auctionEnd', { winnerId: evt.winnerId, amount: evt.amount });
      }
    };

    if (!(this as any)[channel]) {
      (this as any)[channel] = true;
      this.redis.sub.subscribe(channel);
      this.redis.sub.on('message', handler);
    }

    // Send the current price to the newly joined client
    const current = await this.auctionService.getCurrentHighest(auctionId);
    client.emit('currentHighest', { amount: current });
    return { joined: true, room };
  }

  @SubscribeMessage('placeBid')
  async onPlaceBid(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: number; userId: number; amount: number },
  ) {
    const bid = await this.auctionService.placeBidTx({
      auctionId: Number(payload.auctionId),
      userId: Number(payload.userId),
      amount: Number(payload.amount),
    });
    // immediate ack to this bidder; room updates happen via Redis pub/sub
    client.emit('bidAccepted', { bidId: bid.id, amount: bid.amount });
    return { ok: true };
  }

  @SubscribeMessage('endAuction')
  async onEnd(@MessageBody() payload: { auctionId: number }) {
    const updated = await this.auctionService.endAuction(Number(payload.auctionId));
    return { status: updated.status, winnerId: updated.winnerId, amount: updated.currentHighestBid };
  }
}
