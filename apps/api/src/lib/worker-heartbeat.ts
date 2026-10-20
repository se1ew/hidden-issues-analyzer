import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';
export const workerId = `worker-${randomUUID()}`;
export async function beatWorker() {
  const data = { role: 'worker', expiresAt: new Date(Date.now() + 15000) };
  await prisma.serviceHeartbeat.upsert({ where: { id: workerId }, create: { id: workerId, ...data }, update: data });
}
export async function retireWorker() { await prisma.serviceHeartbeat.deleteMany({ where: { id: workerId } }); }
