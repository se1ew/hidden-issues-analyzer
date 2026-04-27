import { vi } from 'vitest';

vi.mock('../config/env.js', () => ({
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
    EMBEDDING_MODEL: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX: 120,
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    product: { findFirst: vi.fn(), create: vi.fn() },
    review: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), createMany: vi.fn() },
    uploadBatch: { create: vi.fn() },
    hiddenIssue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $disconnect: vi.fn(),
  },
  disconnectPrisma: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
