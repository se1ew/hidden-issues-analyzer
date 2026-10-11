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
  OPENROUTER_API_KEY: z.string().trim().min(1).refine(
    (value) => !/^sk-or-v1-X+$/.test(value), 'Замените ключ-заглушку своим API-ключом',
  ),
  OPENROUTER_MODEL: z.string().trim().min(1).default('nvidia/nemotron-3-super-120b-a12b:free'),
  OPENROUTER_BASE_URL: serviceUrl(['http:', 'https:']).default('https://openrouter.ai/api/v1'),
  EMBEDDING_MODEL: z.string().trim().min(1).default('Xenova/paraphrase-multilingual-MiniLM-L12-v2'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
}).superRefine((env, ctx) => {
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
