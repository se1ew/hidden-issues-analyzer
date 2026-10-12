import type { Server as HTTPServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../middleware/auth.js';
import { Redis } from 'ioredis';
import { RUN_UPDATES_CHANNEL } from '../lib/analysis-queue.js';
import { prisma } from '../lib/prisma.js';
import { getAnalysisRun, publicAnalysisRun } from '../services/analysis-runs.service.js';

export interface ServerToClientEvents {
  'analysis:state': (data: ReturnType<typeof publicAnalysisRun>) => void;
  'analysis:progress': (data: { jobId: string; processed: number; total: number; step?: string }) => void;
  'analysis:step': (data: { jobId: string; step: string; label: string }) => void;
  'analysis:complete': (data: { jobId: string }) => void;
  'analysis:error': (data: { jobId: string; message: string }) => void;
  'analysis:cancelled': (data: { jobId: string }) => void;
}

export interface ClientToServerEvents {
  'job:subscribe': (jobId: string) => void;
}

export type AppIOServer = IOServer<ClientToServerEvents, ServerToClientEvents>;

let io: AppIOServer | null = null;
let runSubscriber: Redis | null = null;

function emitRunState(target: ReturnType<AppIOServer['to']>, state: ReturnType<typeof publicAnalysisRun>) {
  const jobId = state.id;
  target.emit('analysis:state', state);
  target.emit('analysis:progress', { jobId, processed: state.processed, total: state.total, step: state.stage });
  if (state.status === 'completed') target.emit('analysis:complete', { jobId });
  else if (state.status === 'cancelled') target.emit('analysis:cancelled', { jobId });
  else if (['partial', 'failed', 'interrupted'].includes(state.status)) {
    target.emit('analysis:error', { jobId, message: state.finishReason === 'grouping_pending'
      ? 'Извлечение сохранено; группировка жалоб ещё не готова'
      : `Запуск завершён: ${state.status}; ошибки: ${state.failed}, осталось: ${state.remaining}` });
  }
}

export async function closeRunNotifications() {
  runSubscriber?.removeAllListeners('message');
  runSubscriber?.disconnect(); runSubscriber = null;
}

export function initSocketIO(httpServer: HTTPServer): AppIOServer {
  io = new IOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
  });
  runSubscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  runSubscriber.on('error', () => logger.warn('Run notifications unavailable; use HTTP state'));
  void runSubscriber.subscribe(RUN_UPDATES_CHANNEL).catch(() => logger.warn('Run subscription unavailable'));
  runSubscriber.on('message', (_channel, runId) => {
    if (typeof runId !== 'string' || runId.length > 60) return;
    void prisma.analysisRun.findUnique({ where: { id: runId } }).then((run) => {
      if (run && io) emitRunState(io.to(`job:${run.id}`), publicAnalysisRun(run));
    }).catch(() => logger.warn('Run notification state unavailable'));
  });

  // Every connection and room subscription requires an authenticated owner.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        socket.data.user = payload;
      } catch { next(new Error('Unauthorized')); return; }
    } else {
      next(new Error('Unauthorized')); return;
    }
    next();
  });

  io.on('connection', (socket) => {
    const expiresAt = socket.data.user.exp;
    const expirationTimer = typeof expiresAt === 'number'
      ? setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt * 1000 - Date.now()))
      : undefined;
    expirationTimer?.unref();
    logger.debug({ id: socket.id, user: socket.data.user?.email }, 'socket connected');

    socket.on('job:subscribe', (jobId: string) => {
      if (typeof jobId !== 'string' || jobId.length > 60) return;
      void getAnalysisRun(jobId, socket.data.user.sub).then(async () => {
        if (!socket.connected) return;
        await socket.join('job:' + jobId);
        const latest = await getAnalysisRun(jobId, socket.data.user.sub);
        if (io) emitRunState(io.to(socket.id), latest);
      }).catch(() => { /* Unknown and foreign runs do not disclose their existence. */ });
    });

    socket.on('disconnect', () => {
      if (expirationTimer) clearTimeout(expirationTimer);
      logger.debug({ id: socket.id }, 'socket disconnected');
    });
  });

  return io;
}

export function getIO(): AppIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
