import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      JWT_REFRESH_SECRET: 'test-refresh-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_MODEL: 'test-model',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      EMBEDDING_MODEL: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      WEB_ORIGIN: 'http://localhost:5173',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
