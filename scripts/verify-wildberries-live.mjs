import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { inspectWildberriesSource } from '../apps/api/dist/services/wildberries-source.js';
const { values } = parseArgs({ options: { product: { type: 'string', default: '123456789' }, output: { type: 'string', default: '.cache/wildberries-live.json' } } });
const started = performance.now();
let report;
let stage = 'input';
const deadline = AbortSignal.timeout(100000);
try {
  const result = await inspectWildberriesSource(values.product, deadline, (next) => { stage = next; });
  report = { capturedAt: new Date().toISOString(), passed: true, productId: result.productId, imtId: result.imtId,
    received: result.received, accepted: result.rows.length, ignored: result.ignored,
    externalIdsPresent: result.rows.every(row => !!row.externalId), historyComplete: false };
} catch (error) {
  const code = deadline.aborted ? 'source_timeout' : error.code ?? (stage === 'input' ? 'invalid_product' : 'source_unavailable');
  report = { capturedAt: new Date().toISOString(), passed: false, stage, code,
    limitation: 'Live source did not satisfy the current contract; use CSV and repeat from the target network.' };
  process.exitCode = 1;
}
report.durationMs = Math.round(performance.now() - started);
await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
await fs.writeFile(values.output, JSON.stringify(report, null, 2));
await new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(report)}\n`, (error) => error ? reject(error) : resolve());
});
// A cancelled lookup can leave OS DNS work pending after the probe has finished.
process.exit(process.exitCode ?? 0);
