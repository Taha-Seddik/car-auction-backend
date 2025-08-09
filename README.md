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
│   ├─ rabbitmq.service.ts            # exchanges/queues helpers
│   ├─ bid.producer.ts                # publish bid.place
│   └─ bid.consumer.ts                # consume bids.process → placeBidTx
└─ tests/
   ├─ FunctionalityTest/
   │ └─ index.html # connect/join/bid/end end-to-end demo
   ├─ RaceTest/
   │ └─ index.html # simultaneous bids race scenario
   └─ BidsSpam/
   └─ index.html # throttling / rate-limit spam test

```

## Assessment Tests (what to verify)

Below are the manual checks I ran using the HTML clients in `/tests`. Each bullet links to a short description with screenshots.

### 1) Create auction
Use the **FunctionalityTest** page or `POST /auctions` to create an active auction.
<table>
<tr>
<td><img alt="create auction form" src="https://github.com/user-attachments/assets/2f0d5920-f19f-47db-b0d7-367826f26b5c" width="100%"></td>
<td><img alt="auction created response" src="https://github.com/user-attachments/assets/1add3837-787d-4661-b8c2-04a93ad660bb" width="100%"></td>
</tr>
</table>

### 2) WebSocket join + current price
Connect from two tabs and join the same auction room — both receive `currentHighest`.
<img alt="ws join + current price" src="https://github.com/user-attachments/assets/2baf51e6-fe1c-4320-84df-065009ece1aa" width="100%">

### 3) Place bid → both tabs update
Placing a bid in one tab broadcasts `bidUpdate` to everyone in the room.
<img alt="bid update broadcast" src="https://github.com/user-attachments/assets/aab916f8-9fbc-4bcc-805d-6bb384dc97b7" width="100%">

### 4) End auction notification
Trigger `endAuction` and all tabs receive `auctionEnd { winnerId, amount }`.
<img alt="auction end broadcast" src="https://github.com/user-attachments/assets/dde2112d-7cbe-4560-98e3-28a94d32ab14" width="100%">

### 5) Race test (simultaneous bids)
Two equal bids fired at the same time — exactly one wins (row lock + tx). DB shows one top row.
<table>
<tr>
<td><img alt="race clients" src="https://github.com/user-attachments/assets/e999c748-3ffa-4d24-b5fe-8be2231443d4" width="100%"></td>
<td><img alt="race result logs" src="https://github.com/user-attachments/assets/102615f4-bb22-466f-86c9-13867ad23f8c" width="100%"></td>
</tr>
</table>

### 6) Guard test (connections)
Open 4 tabs with the same user and click **Connect** — the 4th receives `tooManyConnections` then a server disconnect.
<img alt="too many connections guard" src="https://github.com/user-attachments/assets/85d3ff59-effa-4846-b4a0-2a3107608210" width="60%">

### 7) Bids spam test (throttling)
Burst/timed/flood from **BidsSpam** — after a few `bidQueued`, the guard emits `rateLimited`. RMQ queue rate stays bounded.
<img alt="bids spam throttling" src="https://github.com/user-attachments/assets/f930df46-6dc7-4b08-abac-ca81938285ad" width="100%">

