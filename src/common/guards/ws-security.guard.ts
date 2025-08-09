import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

@Injectable()
export class WsSecurityGuard implements CanActivate {
  private static readonly MAX_PER_IP = 3;
  private static readonly MAX_PER_USER = 3;
  private static readonly PER_SEC = 3;
  private static readonly PER_10S = 6;
  private static ipConns = new Map<string, Set<string>>();
  private static userConns = new Map<number, Set<string>>();
  private static w1 = new Map<string, { n: number; reset: number }>();
  private static w10 = new Map<string, { n: number; reset: number }>();
  private readonly logger = new Logger(WsSecurityGuard.name);

  static onDisconnect(sock: Socket) {
    const ip = this.getIp(sock);
    const uid = this.getUserId(sock);
    this.ipConns.get(ip)?.delete(sock.id);
    if (uid !== null) this.userConns.get(uid)?.delete(sock.id);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const ws = ctx.switchToWs();
    const client = ws.getClient<Socket>();
    const payload = ws.getData() as any;
    const handlerName = ctx.getHandler().name || '';

    this.ensureRegistered(client);

    const { byIp, byUser } = this.counts(client);

    // IP cap
    if (byIp > WsSecurityGuard.MAX_PER_IP) {
      this.logger.warn(
        `Block by IP cap ip=${WsSecurityGuard.getIp(client)} sockets=${byIp}`,
      );
      client.emit('tooManyConnections', {
        by: 'ip',
        limit: WsSecurityGuard.MAX_PER_IP,
      });
      setTimeout(() => client.disconnect(true), 120);
      throw new WsException('Too many connections from this IP');
    }

    // USER cap (add the same delay here)
    if (byUser > WsSecurityGuard.MAX_PER_USER) {
      this.logger.warn(
        `Block by USER cap userId=${WsSecurityGuard.getUserId(client)} sockets=${byUser}`,
      );
      client.emit('tooManyConnections', {
        by: 'user',
        limit: WsSecurityGuard.MAX_PER_USER,
      });
      setTimeout(() => client.disconnect(true), 120);
      throw new WsException('Too many connections for this user');
    }

    // Throttle only placeBid
    if (handlerName === 'onPlaceBid') {
      const key = this.bucketKey(client, payload);
      const now = Date.now();

      let a = WsSecurityGuard.w1.get(key);
      if (!a || a.reset <= now) a = { n: 0, reset: now + 1000 };
      a.n++;
      WsSecurityGuard.w1.set(key, a);

      let b = WsSecurityGuard.w10.get(key);
      if (!b || b.reset <= now) b = { n: 0, reset: now + 10_000 };
      b.n++;
      WsSecurityGuard.w10.set(key, b);

      if (a.n > WsSecurityGuard.PER_SEC || b.n > WsSecurityGuard.PER_10S) {
        this.logger.warn(
          `RateLimited key=${key} 1s=${a.n}/${WsSecurityGuard.PER_SEC} 10s=${b.n}/${WsSecurityGuard.PER_10S}`,
        );
        client.emit('rateLimited', {
          perSec: WsSecurityGuard.PER_SEC,
          per10s: WsSecurityGuard.PER_10S,
        });
        throw new WsException('Rate limit exceeded');
      }
    }

    return true;
  }

  // ---- helpers ----
  private ensureRegistered(sock: Socket) {
    const ip = WsSecurityGuard.getIp(sock);
    const uid = WsSecurityGuard.getUserId(sock);

    const ipSet = WsSecurityGuard.ipConns.get(ip) ?? new Set<string>();
    if (!ipSet.has(sock.id)) {
      ipSet.add(sock.id);
      WsSecurityGuard.ipConns.set(ip, ipSet);
    }

    if (uid !== null) {
      const uSet = WsSecurityGuard.userConns.get(uid) ?? new Set<string>();
      if (!uSet.has(sock.id)) {
        uSet.add(sock.id);
        WsSecurityGuard.userConns.set(uid, uSet);
      }
    }
  }

  private counts(sock: Socket) {
    const ip = WsSecurityGuard.getIp(sock);
    const uid = WsSecurityGuard.getUserId(sock);
    return {
      byIp: WsSecurityGuard.ipConns.get(ip)?.size ?? 0,
      byUser:
        uid !== null ? (WsSecurityGuard.userConns.get(uid)?.size ?? 0) : 0,
    };
  }

  private bucketKey(sock: Socket, data: any) {
    const uid = WsSecurityGuard.getUserId(sock) ?? Number(data?.userId);
    if (Number.isFinite(uid) && uid > 0) return `u:${uid}`;
    const ip = WsSecurityGuard.getIp(sock);
    return `ip:${ip}`;
  }

  private static getIp(sock: Socket): string {
    const fwd = (sock.handshake.headers['x-forwarded-for'] as string) || '';
    return (
      fwd.split(',')[0] ||
      sock.handshake.address ||
      (sock.conn as any).remoteAddress ||
      'unknown'
    ).trim();
  }
  private static getUserId(sock: Socket): number | null {
    const v =
      (sock.handshake.auth && (sock.handshake.auth as any).userId) ||
      (sock.handshake.query && (sock.handshake.query as any).userId);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
