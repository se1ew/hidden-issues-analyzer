import { z } from 'zod';

function serviceUrl(protocols: string[]) {
  return z.string().url().refine((value) => {
    try { return protocols.includes(new URL(value).protocol); }
    catch { return false; }
  }, {
    message: `Ожидается протокол ${protocols.join(' или ')}`,
  });
}

const tokenTtl = z.string().regex(/^[1-9]\d*(s|m|h|d)$/, 'TTL должен иметь вид 15m, 1h или 7d');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().trim().min(1).default('0.0.0.0'),
  WEB_ORIGIN: serviceUrl(['http:', 'https:']).default('http://localhost:5173'),
  DATABASE_URL: serviceUrl(['postgres:', 'postgresql:']),
  REDIS_URL: serviceUrl(['redis:', 'rediss:']),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: tokenTtl.default('15m'),
  JWT_REFRESH_TTL: tokenTtl.default('7d'),
  OPENROUTER_API_KEY: z.string().trim().optional(),
  OPENROUTER_MODEL: z.string().trim().min(1).default('nvidia/nemotron-3-super-120b-a12b:free'),
  OPENROUTER_BASE_URL: serviceUrl(['http:', 'https:']).default('https://openrouter.ai/api/v1'),
  LLM_PROVIDER: z.enum(['local', 'openrouter']).default('local'),
  LLM_BASE_URL: serviceUrl(['http:', 'https:']).optional(),
  LLM_MODEL: z.string().trim().min(1).max(200).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(60_000),
  LLM_CONTEXT_TOKENS: z.coerce.number().int().min(256).max(131_072).default(4096),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32_768).default(1024),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  LLM_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  LLM_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(500),
  LLM_MAX_RETRY_DELAY_MS: z.coerce.number().int().min(1).max(30_000).default(5000),
  LLM_RESPONSE_FORMAT: z.enum(['none', 'json_object', 'json_schema']).default('json_object'),
  LLM_CLOUD_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(4000),
  EMBEDDING_MODEL: z.string().trim().min(1).default('Xenova/paraphrase-multilingual-MiniLM-L12-v2'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
}).superRefine((env, ctx) => {
  if (env.LLM_PROVIDER === 'openrouter' && (!env.OPENROUTER_API_KEY || /^sk-or-v1-X+$/.test(env.OPENROUTER_API_KEY))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OPENROUTER_API_KEY'], message: 'Для OpenRouter нужен настоящий API-ключ' });
  }
  if (env.LLM_MAX_OUTPUT_TOKENS >= env.LLM_CONTEXT_TOKENS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['LLM_MAX_OUTPUT_TOKENS'], message: 'Выход должен быть меньше контекста' });
  }
  if (env.LLM_BASE_URL && (new URL(env.LLM_BASE_URL).username || new URL(env.LLM_BASE_URL).password
    || new URL(env.LLM_BASE_URL).search || new URL(env.LLM_BASE_URL).hash)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['LLM_BASE_URL'], message: 'URL модели не должен содержать credentials, query или fragment' });
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'Access и refresh требуют разных секретов' });
  }
  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].startsWith('change_me_')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Замените секрет-заглушку перед production-запуском' });
      }
    }
  }
});
