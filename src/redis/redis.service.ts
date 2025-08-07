import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly pub: Redis;   // for publishing
  public readonly sub: Redis;   // for subscribing
  public readonly cache: Redis; // for get/set cache

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    this.cache = new Redis(url, { lazyConnect: false });
    this.pub   = new Redis(url, { lazyConnect: false });
    this.sub   = new Redis(url, { lazyConnect: false });
  }

  async onModuleDestroy() {
    await Promise.all([this.pub.quit(), this.sub.quit(), this.cache.quit()]);
  }

  auctionKey(auctionId: number) {
    return `auction:${auctionId}:currentHighestBid`;
  }

  channel(auctionId: number) {
    return `auction:${auctionId}:updates`;
  }
}
