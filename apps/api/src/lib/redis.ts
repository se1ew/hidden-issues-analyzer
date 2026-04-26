import { Redis as RedisClient } from 'ioredis';
import { env } from '../config/env.js';

export const redis: RedisClient = new RedisClient(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] error:', err.message);
});

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}
