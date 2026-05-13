import type { Server as HTTPServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../middleware/auth.js';

export interface ServerToClientEvents {
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

export interface JobState {
  status: 'analyzing' | 'complete' | 'error';
  processed: number;
  total: number;
  step: string;
  label: string;
  error?: string;
}

const jobStore = new Map<string, JobState>();

export function setJobState(jobId: string, patch: Partial<JobState>): void {
  const prev = jobStore.get(jobId) ?? {
    status: 'analyzing' as const,
    processed: 0,
    total: 0,
    step: 'analyzing',
    label: 'Анализ...',
  };
  jobStore.set(jobId, { ...prev, ...patch });
}

export function deleteJobState(jobId: string): void {
  jobStore.delete(jobId);
}

let io: AppIOServer | null = null;

export function initSocketIO(httpServer: HTTPServer): AppIOServer {
  io = new IOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
  });

  // Опциональная JWT-аутентификация по handshake.auth.token
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        socket.data.user = payload;
      } catch {
        // anonymous socket
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id, user: socket.data.user?.email }, 'socket connected');

    socket.on('job:subscribe', (jobId: string) => {
      socket.join(`job:${jobId}`);
      // Replay current job state so late-subscribing clients catch up
      const state = jobStore.get(jobId);
      if (state) {
        if (state.status === 'complete') {
          socket.emit('analysis:step', { jobId, step: 'done', label: 'Готово' });
          socket.emit('analysis:complete', { jobId });
        } else if (state.status === 'error') {
          socket.emit('analysis:error', { jobId, message: state.error ?? 'Unknown error' });
        } else {
          socket.emit('analysis:step', { jobId, step: state.step, label: state.label });
          socket.emit('analysis:progress', {
            jobId,
            processed: state.processed,
            total: state.total,
            step: state.step,
          });
        }
      }
    });

    socket.on('disconnect', () => {
      logger.debug({ id: socket.id }, 'socket disconnected');
    });
  });

  return io;
}

export function getIO(): AppIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
