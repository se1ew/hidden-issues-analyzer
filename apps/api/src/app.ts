import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { logContext } from './lib/log-context.js';
import { logger } from './lib/logger.js';
import { LIMITS } from './lib/resource-limits.js';
import { readiness } from './services/diagnostics.service.js';

import { env } from './config/env.js';
import { errorHandler, errorBody, notFound } from './middleware/error.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin (no origin header) and configured origin
        if (!origin || origin === env.WEB_ORIGIN) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: LIMITS.jsonBytes }));
  app.use(express.urlencoded({ extended: true, limit: LIMITS.jsonBytes }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const requestId = randomUUID(); res.setHeader('X-Request-ID', requestId);
    logContext.run({ requestId }, () => {
      res.on('finish', () => logger.info({ requestId, method: req.method, status: res.statusCode }, 'HTTP request completed'));
      next();
    });
  });

  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: errorBody('rate_limited', 'Слишком много запросов. Повторите позже.'),
  });
  app.use('/api', limiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/ready', async (_req, res) => { const data = await readiness(); res.status(data.status === 'ready' ? 200 : 503).json(data); });

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
