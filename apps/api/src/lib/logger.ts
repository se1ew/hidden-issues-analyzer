import { logContext } from './log-context.js';
import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  mixin: () => ({ ...logContext.getStore() }),
  serializers: { err: (error: { name?: string; code?: string }) => ({ name: error?.name ?? 'Error', code: error?.code ?? 'unknown' }) },
  redact: { paths: ['password', 'token', 'authorization', 'apiKey', 'text', 'rawResponse', 'req.headers.authorization', 'req.headers.cookie', 'settings'], censor: '[redacted]' },
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
});
