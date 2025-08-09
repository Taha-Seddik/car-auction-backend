import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Observable } from 'rxjs';

@Injectable()
export class WsPayloadInterceptor implements NestInterceptor {
  private readonly MAX_BYTES = 1024; // 1KB

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ws = context.switchToWs();
    const data = ws.getData();
    const handler = context.getHandler().name || '';

    // Hard size cap
    const size = Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
    if (size > this.MAX_BYTES) throw new WsException('Payload too large');

    // Minimal schema checks for our two events
    if (handler === 'onPlaceBid') {
      const ok =
        typeof data === 'object' &&
        Number.isFinite(Number((data as any)?.auctionId)) &&
        Number.isFinite(Number((data as any)?.userId)) &&
        Number.isFinite(Number((data as any)?.amount));
      if (!ok) throw new WsException('Invalid placeBid payload');
    }
    if (handler === 'onJoin') {
      const ok =
        typeof data === 'object' &&
        Number.isFinite(Number((data as any)?.auctionId));
      if (!ok) throw new WsException('Invalid joinAuction payload');
    }

    return next.handle();
  }
}
