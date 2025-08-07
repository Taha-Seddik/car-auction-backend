import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create Users
  const user1 = await prisma.user.create({
    data: {
      username: 'taha',
      email: 'taha@example.com',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      username: 'sara',
      email: 'sara@example.com',
    },
  });

  // Create Auctions
  const auction1 = await prisma.auction.create({
    data: {
      carId: 'car-abc123',
      startTime: new Date('2025-08-08T09:00:00Z'),
      endTime: new Date('2025-08-09T09:00:00Z'),
      startingBid: 1000,
      status: 'active',
    },
  });

  // Create Bids
  await prisma.bid.create({
    data: {
      userId: user1.id,
      auctionId: auction1.id,
      amount: 1100,
    },
  });

  await prisma.bid.create({
    data: {
      userId: user2.id,
      auctionId: auction1.id,
      amount: 1200,
    },
  });

  console.log('Seed data created!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
