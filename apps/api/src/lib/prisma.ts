import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

const databaseUrl = new URL(env.DATABASE_URL);
for (const [key, value] of Object.entries({ connection_limit: '5', connect_timeout: '3', pool_timeout: '3' })) if (!databaseUrl.searchParams.has(key)) databaseUrl.searchParams.set(key, value);
export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl.toString() } },
  log: [],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
