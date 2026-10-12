import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-xxxxxxxxxxxxxxxxxx',
  JWT_REFRESH_SECRET: 'test-refresh-secret-xxxxxxxxxxxxxxxxxx',
  OPENROUTER_API_KEY: 'test-api-key-not-real',
  LLM_PROVIDER: 'openrouter',
};

describe('startup environment schema', () => {
  it('применяет документированные defaults', () => {
    expect(EnvSchema.parse(valid)).toMatchObject({ API_PORT: 4000, API_HOST: '0.0.0.0', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d' });
  });

  it.each([
    { API_PORT: '65536' }, { API_PORT: '0' }, { API_HOST: ' ' },
    { DATABASE_URL: 'https://localhost/database' }, { DATABASE_URL: 'not-a-url' }, { REDIS_URL: 'postgresql://localhost/db' },
    { JWT_ACCESS_SECRET: 'short' }, { JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET },
    { JWT_ACCESS_TTL: 'forever' }, { OPENROUTER_MODEL: ' ' },
    { OPENROUTER_API_KEY: 'sk-or-v1-XXXXXXXXXXXXXXXX' }, { RATE_LIMIT_MAX: '0' },
  ])('отклоняет некорректное поле %j', (overrides) => {
    expect(EnvSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });

  it('не допускает JWT-заглушку в production', () => {
    expect(EnvSchema.safeParse({ ...valid, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change_me_access_secret_at_least_32_chars_long' }).success).toBe(false);
  });

  it.each(['../../.env.example', '../../../../.env.example'])('шаблон %s поддерживает локальный режим без облачного ключа', (relativePath) => {
    const template = parse(readFileSync(new URL(relativePath, import.meta.url)));
    const replaced = EnvSchema.parse({ ...template, OPENROUTER_API_KEY: valid.OPENROUTER_API_KEY });
    for (const key of Object.keys(replaced)) expect(template).toHaveProperty(key);
    expect(EnvSchema.safeParse(template).success).toBe(true);
    expect(EnvSchema.safeParse({ ...template, LLM_PROVIDER: 'openrouter' }).success).toBe(false);
  });

  it('локальный режим не требует облачного ключа', () => {
    expect(EnvSchema.safeParse({ ...valid, LLM_PROVIDER: 'local', OPENROUTER_API_KEY: undefined }).success).toBe(true);
  });

  it.each([{ LLM_PROVIDER: 'automatic' }, { LLM_TIMEOUT_MS: 0 }, { LLM_CONCURRENCY: 9 },
    { LLM_RETRIES: 4 }, { LLM_MAX_OUTPUT_TOKENS: 4096 }, { LLM_RESPONSE_FORMAT: 'automatic' },
    { LLM_BASE_URL: 'http://user:password@localhost:8080/v1' }, { LLM_BASE_URL: 'http://localhost:8080/v1?key=secret' },
  ])('отклоняет некорректную настройку модели %j', (overrides) => {
    expect(EnvSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });
});
