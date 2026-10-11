import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

dotenv.config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)) });
assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
assert(process.env.REDIS_URL, 'REDIS_URL is required');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});

try {
  await redis.connect();
  const [products, pong] = await Promise.all([prisma.product.count(), redis.ping()]);
  assert.equal(pong, 'PONG');
  console.log(`PostgreSQL schema reachable (${products} products); Redis PONG.`);
} catch {
  console.error('Service check failed. Check PostgreSQL/Redis availability, connection settings and applied migrations.');
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
