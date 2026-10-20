import { prisma } from '../lib/prisma.js';
import { getAnalysisQueue } from '../lib/analysis-queue.js';
export async function boundedCheck(operation: () => Promise<unknown>, ms = 2500) {
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]); return true; }
  catch { return false; } finally { clearTimeout(timer!); }
}
export async function readiness() {
  const [database, queue, worker] = await Promise.all([
    boundedCheck(() => prisma.$queryRaw`SELECT 1`),
    boundedCheck(async () => (await getAnalysisQueue().client).ping()),
    boundedCheck(async () => { if (!await prisma.serviceHeartbeat.findFirst({ where: { role: 'worker', expiresAt: { gt: new Date() } } })) throw new Error('worker_missing'); }),
  ]);
  return { status: database && queue && worker ? 'ready' : 'degraded', database, queue, worker,
    model: { state: 'unchecked', action: 'Проверьте модель отдельно в настройках. Доступность модели не влияет на чтение сохранённых результатов.' } };
}
