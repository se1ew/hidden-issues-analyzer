import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../config/env.js';
import { getAnalysisQueue } from './analysis-queue.js';

// All API summaries and workers use one expiring semaphore. Redis TIME avoids
// clock differences between processes; a lost permit aborts the HTTP request.
const key = `${env.ANALYSIS_QUEUE_NAME}:llm-capacity`;
const ttl = 10_000;
const acquire = `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[3]),ARGV[1]); redis.call('PEXPIRE',KEYS[1],ARGV[3]); return 1`;
const renew = `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local score=redis.call('ZSCORE',KEYS[1],ARGV[1]); if not score or tonumber(score)<=now then return 0 end
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',KEYS[1],ARGV[2]); return 1`;

export async function withLlmCapacity<T>(operation: (signal: AbortSignal) => Promise<T>, external: AbortSignal): Promise<T> {
  const client = await getAnalysisQueue().client;
  const token = randomUUID();
  external.throwIfAborted();
  while (Number(await client.eval(acquire, 1, key, token, env.LLM_CONCURRENCY, ttl)) !== 1) {
    await delay(50, undefined, { signal: external });
  }
  const controller = new AbortController();
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void client.eval(renew, 1, key, token, ttl).then((result) => {
      if (Number(result) !== 1) controller.abort();
    }).catch(() => controller.abort()).finally(() => { renewing = false; });
  }, 1000);
  timer.unref();
  try { return await operation(AbortSignal.any([external, controller.signal])); }
  finally {
    clearInterval(timer);
    await client.zrem(key, token).catch(() => undefined);
  }
}
