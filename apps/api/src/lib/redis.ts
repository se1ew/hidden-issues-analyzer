import { logger } from './logger.js';
import { Redis as RedisClient } from 'ioredis';
import { env } from '../config/env.js';

export const redis: RedisClient = new RedisClient(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  logger.warn({ code: err.name }, 'Redis unavailable');
});

export async function disconnectRedis(): Promise<void> {
  redis.disconnect();
}
