import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { closeRunNotifications, initSocketIO } from './sockets/index.js';
import { closeAnalysisQueue, dispatchQueuedAnalysisRuns } from './lib/analysis-queue.js';
import { interruptExpiredRuns } from './services/analysis-runs.service.js';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  initSocketIO(httpServer);
  let dispatching = false;
  const dispatcher = setInterval(() => {
    if (dispatching) return; dispatching = true;
    void interruptExpiredRuns().then(() => dispatchQueuedAnalysisRuns())
      .catch(() => logger.warn('Run dispatcher unavailable; PostgreSQL state is retained'))
      .finally(() => { dispatching = false; });
  }, env.ANALYSIS_DISPATCH_MS);
  dispatcher.unref();

  httpServer.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(`🚀 API listening on http://${env.API_HOST}:${env.API_PORT}`);
    logger.info(`   CORS origin: ${env.WEB_ORIGIN}`);
    logger.info(`   NODE_ENV: ${env.NODE_ENV}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    httpServer.close();
    clearInterval(dispatcher);
    await closeRunNotifications();
    await closeAnalysisQueue();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to bootstrap API');
  process.exit(1);
});
