import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { extractWbId, parseWildberries } from './parsing.service.js';
import { logContext } from '../lib/log-context.js';

export async function queueParsing(value: string, userId: string) {
  const externalId = String(extractWbId(value));
  const url = `https://www.wildberries.ru/catalog/${externalId}/detail.aspx`;
  return prisma.$transaction(async tx => {
    const product = await tx.product.upsert({ where: { userId_source_externalId: { userId, source: 'wildberries', externalId } },
      create: { userId, name: `WB ${externalId}`, source: 'wildberries', externalId, sourceUrl: url }, update: {} });
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${product.id} FOR UPDATE`;
    const existing = await tx.uploadBatch.findFirst({ where: { productId: product.id, userId, source: 'parsing', status: { in: ['pending', 'running'] } } });
    const batch = existing ?? await tx.uploadBatch.create({ data: { userId, productId: product.id, source: 'parsing', filename: url, status: 'pending', diagnostics: { historyComplete: false } } });
    return { jobId: batch.id, status: batch.status, internalProductId: product.id };
  });
}

export async function cancelParsing(id: string, userId: string) {
  const batch = await prisma.uploadBatch.findFirst({ where: { id, userId, source: 'parsing', product: { userId } } });
  if (!batch) throw new HttpError(404, 'Импорт не найден');
  await prisma.uploadBatch.updateMany({ where: { id, userId, status: { in: ['pending', 'running'] } }, data: { status: 'interrupted', errorCode: 'owner_cancelled', finishedAt: new Date(), leaseExpiresAt: null } });
}

export async function processNextParsing(shutdown?: AbortSignal, batchId?: string) {
  if (shutdown?.aborted) return;
  await prisma.uploadBatch.updateMany({ where: { source: 'parsing', status: 'running', leaseExpiresAt: { lt: new Date() } },
    data: { status: 'interrupted', errorCode: 'worker_restarted', leaseExpiresAt: null, finishedAt: new Date() } });
  const batch = await prisma.uploadBatch.findFirst({ where: { ...(batchId ? { id: batchId } : {}), source: 'parsing', status: 'pending', productId: { not: null }, userId: { not: null } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!batch) return;
  const claimed = await prisma.uploadBatch.updateMany({ where: { id: batch.id, status: 'pending' }, data: { status: 'running', startedAt: new Date(), attemptCount: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + 15000) } });
  if (!claimed.count) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000), ...(shutdown ? [shutdown] : [])]);
  let ticking = false;
  const heartbeat = setInterval(() => {
    if (ticking) return; ticking = true;
    void prisma.uploadBatch.updateMany({ where: { id: batch.id, status: 'running' }, data: { leaseExpiresAt: new Date(Date.now() + 15000) } })
      .then(state => { if (!state.count) controller.abort(); }).catch(() => controller.abort()).finally(() => { ticking = false; });
  }, 1000);
  heartbeat.unref();
  try {
    await logContext.run({ importId: batch.id }, () => parseWildberries(batch.filename!, batch.userId!, { signal, batchId: batch.id, internalProductId: batch.productId! }));
  } catch (error) {
    const code = shutdown?.aborted ? 'worker_shutdown' : signal.aborted ? 'source_cancelled' : error instanceof HttpError ? error.code ?? 'source_unavailable' : 'source_unavailable';
    await prisma.uploadBatch.updateMany({ where: { id: batch.id, status: 'running' }, data: { status: signal.aborted ? 'interrupted' : 'failed', errorCode: code, finishedAt: new Date(), leaseExpiresAt: null } });
  } finally { clearInterval(heartbeat); }
}
