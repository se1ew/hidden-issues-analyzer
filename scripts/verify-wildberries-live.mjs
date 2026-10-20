import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
const { values } = parseArgs({ options: { product: { type: 'string', default: '123456789' }, output: { type: 'string', default: '.cache/wildberries-live.json' } } });
dotenv.config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)), quiet: true });
const { inspectWildberriesSource } = await import('../apps/api/dist/services/parsing.service.js');
const started = performance.now();
let report;
try {
  const result = await inspectWildberriesSource(values.product, AbortSignal.timeout(100000));
  report = { capturedAt: new Date().toISOString(), passed: true, productId: result.productId, imtId: result.imtId,
    received: result.received, accepted: result.rows.length, ignored: result.ignored,
    externalIdsPresent: result.rows.every(row => !!row.externalId), historyComplete: false };
} catch (error) {
  report = { capturedAt: new Date().toISOString(), passed: false, code: error.code ?? 'source_unavailable',
    limitation: 'Live source did not satisfy the current contract; use CSV and repeat from the target network.' };
  process.exitCode = 1;
} finally {
  report.durationMs = Math.round(performance.now() - started);
  await fs.mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
  await fs.writeFile(values.output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  const { disconnectPrisma } = await import('../apps/api/dist/lib/prisma.js'); await disconnectPrisma();
}
