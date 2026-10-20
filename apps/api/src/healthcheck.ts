import { prisma, disconnectPrisma } from './lib/prisma.js';
import { workerId } from './lib/worker-heartbeat.js';

try {
  const heartbeat = await prisma.serviceHeartbeat.findFirst({ where: { id: workerId, expiresAt: { gt: new Date() } } });
  if (!heartbeat) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await disconnectPrisma(); }
