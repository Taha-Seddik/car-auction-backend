# Live Car Auction – MVP 

## Intro
NestJS backend for real-time car auctions: Socket.IO live bids, PostgreSQL/Prisma transactions, Redis cache/pub-sub, RabbitMQ processing (with DLQ), plus simple guard-based rate limiting. Includes a minimal web client for quick testing

## Tech Stack

- **NestJS** (HTTP + WebSocket gateway)
- **Socket.IO** (real-time events)
- **PostgreSQL + Prisma** (data + transactions)
- **Redis** (cache current price + pub/sub cross-instance)
- **RabbitMQ** (reliable bid queueing + DLQ + notifications/audit)
- **Docker Compose** (Postgres, Redis, RabbitMQ)

## How to run the project

```bash
# 1) Infra
docker compose up -d

# 2) DB schema
npx prisma migrate dev

# 3) Seed sample data 
npx ts-node src/prisma/seed.ts

# 4) App
npm run start:dev
```

Here’s a corrected, tidy **Project Structure** section that matches your repo:

# Project Structure (important parts)

```
├─ docker-compose.yml
├─ .env
├─ prisma/
│  └─ schema.prisma                     # User, Auction, Bid models
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ app.controller.ts
│  ├─ auction/
│  │  ├─ auction.controller.ts          # HTTP: create/get
│  │  ├─ auction.gateway.ts             # WS: joinAuction, placeBid, endAuction
│  │  ├─ auction.service.ts             # DB txns, Redis cache/pub, end logic
│  │  └─ auction-closer.service.ts      # scheduled closer (auto-complete)
│  ├─ bid/
│  │  ├─ bid.controller.ts
│  │  └─ bid.service.ts
│  ├─ user/
│  │  ├─ user.controller.ts
│  │  └─ user.service.ts
│  ├─ common/
│  │  ├─ guards/
│  │  │  └─ ws-security.guard.ts        # connection caps + bid throttling
│  │  └─ interceptors/
│  │     └─ ws-payload.interceptor.ts   # optional payload size/shape checks
│  ├─ dto/                              # request/response DTOs
│  ├─ prisma/
│  │  └─ prisma.service.ts              # PrismaClient wrapper for Nest
│  ├─ redis/
│  │  └─ redis.service.ts               # cache + pub/sub
│  └─ rabbitMq/
│     ├─ rabbitmq.service.ts            # exchanges/queues helpers
│     ├─ bid.producer.ts                # publish bid.place
│     └─ bid.consumer.ts                # consume bids.process → placeBidTx
└─ scripts/
   └─ test-guard-throttle.js            # optional throttle demo
```


## DDoS/Spam Mitigation (simple & visible)

- **Guard (`WsSecurityGuard`)**
  - **Connection caps** per IP and per user (defaults: 3 each). On violation, emits `tooManyConnections` then disconnects.
  - **Bid throttling** per user/IP: **5/sec** and **20/10s** (tweak constants). On violation, emits `rateLimited` and blocks the handler (no RMQ publish).

- **Interceptor (`WsPayloadInterceptor`, optional)**
  - Caps payload to **1KB** and validates minimal shape for `joinAuction` / `placeBid`.

> These are per-process (simple for demo). For multi-instance production, replace the in-memory Maps with Redis counters/sets using the same keys.

---

## Assessment Tests (what to verify)

1. **Create auction**  
   Use the Create Auction form (or `POST /auctions`).

2. **WebSocket join + current price**  
   Connect in two tabs; both receive `currentHighest` with the latest price.

3. **Place bid updates both tabs**  
   Place a bid in Tab A → both tabs receive `bidUpdate` broadcast.

4. **End auction notification**  
   Trigger `endAuction` → both tabs receive `auctionEnd { winnerId, amount }`.

5. **Race test**  
   Fire two equal bids at the same time (two tabs). Exactly **one** wins;
   loser is rejected by transaction logic. DB shows only one top bid row.

6. **Guard test (connections)**  
   Open 4 tabs with the same user and click **Connect**: in the 4th tab you get
   `tooManyConnections { by: 'user', limit: 3 }` then a server disconnect.

7. **Bids spam test**  
   Spam bids (burst/timed/flood). You’ll see some `bidQueued`, then `rateLimited`.
   RabbitMQ queue rate remains bounded; excess is blocked before enqueue.

> Add your screenshots under each section in GitHub (RabbitMQ UI, Prisma Studio, browser logs).

---


