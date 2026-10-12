import { vi } from 'vitest';

vi.mock('./config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    API_PORT: 4000,
    API_HOST: '0.0.0.0',
    WEB_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-access-secret-xxxxxxxxxxxxxxxxxx',
    JWT_REFRESH_SECRET: 'test-refresh-secret-xxxxxxxxxxxxxxxxxx',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    OPENROUTER_API_KEY: 'sk-test',
    OPENROUTER_MODEL: 'test-model',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_PROVIDER: 'local', LLM_MODEL: 'test-model', LLM_BASE_URL: 'http://127.0.0.1:8080/v1',
    LLM_TIMEOUT_MS: 60000, LLM_CONTEXT_TOKENS: 4096, LLM_MAX_OUTPUT_TOKENS: 1024,
    LLM_CONCURRENCY: 1, LLM_RETRIES: 2, LLM_RETRY_DELAY_MS: 500,
    LLM_MAX_RETRY_DELAY_MS: 5000, LLM_RESPONSE_FORMAT: 'json_object', LLM_CLOUD_DELAY_MS: 4000,
    EMBEDDING_MODEL: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX: 120,
  },
}));

vi.mock('./lib/prisma.js', () => ({
  prisma: {
    product: { findFirst: vi.fn(), create: vi.fn() },
    review: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    uploadBatch: { create: vi.fn() },
    $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => {
      const { prisma } = await import('./lib/prisma.js');
      return operation(prisma);
    }),
    hiddenIssue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $disconnect: vi.fn(),
  },
  disconnectPrisma: vi.fn(),
}));

vi.mock('./lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
