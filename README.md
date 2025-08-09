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

## Project Structure (important parts)

```
src/
  app.module.ts
  main.ts

  prisma/
    prisma.service.ts
    seed.ts

  auction/
    auction.controller.ts       # HTTP: create/get
    auction.service.ts          # DB tx, redis cache/pub, end-auction
    auction.gateway.ts          # WS events: joinAuction, placeBid, endAuction

    interceptors/
      ws-payload.interceptor.ts # (optional) size/shape filter

    guards/
      ws-security.guard.ts      # single guard: connection caps + bid throttling

  redis/
    redis.service.ts            # ioredis client + cache/pub/sub helpers

  rabbitMq/
    rabbitmq.service.ts         # exchanges/queues + publish/consume helpers
    bid.producer.ts             # publishes bid messages (bid.place)
    bid.consumer.ts             # consumes + calls auction.service.placeBidTx

  prisma/schema.prisma          # User, Auction, Bid
  generated/prisma/             # Prisma client output (if customized)

scripts/
  test-guard-throttle.js        # optional node test for throttling
web/
  index.html                    # simple browser test client (you created)
```
---

## Environment

Create `.env` at the project root:

```
DATABASE_URL=postgresql://auction_user:auction_pass@localhost:5432/carauction
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://auction_user:auction_pass@localhost:5672
PORT=3000
```

> No quotes needed. Host `localhost` works because Nest runs on your host and the services are exposed by Docker.

---



Quick checks:

- **HTTP/WS**: `http://localhost:3000` (WS namespace `/ws`)
- **RabbitMQ UI**: `http://localhost:15672` (default creds from compose)
  - Queues: `bids.process`, `bids.dlq`, `notify.user`, `audit.log`
- **Redis**: `redis-cli -u redis://localhost:6379 PING` → `PONG`
- **DB**: `npx prisma studio`

---

## WebSocket API (client → server)

- `joinAuction` `{ auctionId }` → joins a Socket.IO room; server replies with `currentHighest`
- `placeBid` `{ auctionId, userId, amount }` → enqueues via RabbitMQ; immediate `bidQueued`; later `bidUpdate` broadcast after processing
- `endAuction` `{ auctionId }` → closes auction; emits `auctionEnd` to room

### Server → client events

- `currentHighest` `{ amount }`
- `bidQueued` `{ ok: true }`
- `bidUpdate` `{ amount, userId, ts }`
- `auctionEnd` `{ winnerId, amount }`
- `bidError` `{ message }`
- **Guard/Interceptor**
  - `tooManyConnections` `{ by: 'ip'|'user', limit }`
  - `rateLimited` `{ perSec, per10s }`

---

## HTTP API (minimal)

- `POST /auctions`  
  Body: `{ carId: string, minutes: number, startingBid: number }`  
  → creates an **active** auction (ends at `now + minutes`)

- `GET /auctions` / `GET /auctions/:id` (optional helper endpoints)

---

## Concurrency & Messaging

### PostgreSQL + Prisma
- `placeBidTx` uses **row lock** (`SELECT … FOR UPDATE`) to serialize writers:
  1) verify `active` + not expired
  2) enforce `amount >= (currentHighestBid || startingBid) + 1`
  3) `tx.bid.create()`
  4) `tx.auction.update({ currentHighestBid })`
- **After commit**: update Redis cache + publish Redis channel (`bidUpdate`)

### Redis
- **Cache**: `auction:{id}:highest` → current price (avoid DB reads)
- **Pub/Sub**: channel per auction `chan:auction:{id}` → `bidUpdate` / `auctionEnd`
- Gateway subscribes per room; broadcasts to all clients.

### RabbitMQ
- Exchanges:
  - `bids` (direct) – bid processing
  - `bids.dlx` (direct) – dead letters
  - `notify` (fanout) – notifications
  - `audit` (fanout) – audit events
- Queues:
  - `bids.process`  (bind `bids` with `bid.place`)
  - `bids.dlq`      (bind `bids.dlx` with `bid.dead`)
  - `notify.user`   (bind `notify`)
  - `audit.log`     (bind `audit`)
- Producer: publishes `{ auctionId, userId, amount }` to `bids` with `bid.place`
- Consumer: runs `placeBidTx`; on success publishes to `notify` & `audit`
- **Retries**: simple header `x-retry` (0..3). Business errors (too low, inactive, ended) are ACKed (no retry). Technical failures go to DLQ.

---

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

## Notes & Trade-offs

- Guard & interceptor are intentionally **simple** (no extra deps) to keep code readable.
- Row-lock keeps the transaction short; Redis work is after-commit to avoid timeouts.
- Business rejections are **not retried**; only technical failures go to DLQ.
- For multi-instance scale, swap in Redis for guard counters/sets.
- A small `@nestjs/schedule` cron closes expired auctions automatically and publishes `auctionEnd`.
