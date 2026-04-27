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
}

export interface ClientToServerEvents {
  'job:subscribe': (jobId: string) => void;
}

export type AppIOServer = IOServer<ClientToServerEvents, ServerToClientEvents>;

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
