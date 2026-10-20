import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';

export async function evaluateCases(cases, provider, modelVersion = 'unverified') {
  const { extractReview } = await import('../apps/api/dist/services/chunked-extraction.service.js');
  const { prepareExtraction, EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION } = await import('../apps/api/dist/services/extraction.service.js');
  const config = provider.config;
  const report = { capturedAt: new Date().toISOString(), kind: 'model-evaluation-requires-human-adjudication',
    reviewedBy: null, approvedThresholds: null,
    configuration: { provider: config.provider, model: config.model, modelVersion,
      contextTokens: config.contextTokens, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs,
      retries: config.retries, responseFormat: config.responseFormat, concurrency: 1,
      promptVersion: EXTRACTION_PROMPT_VERSION, methodVersion: EXTRACTION_METHOD_VERSION, cache: 'disabled-for-evaluation' },
    cases: [], totals: { total: cases.length, succeeded: 0, failed: 0, validatedQuotes: 0, precision: null, recall: null } };
  for (const item of cases) {
    const started = performance.now();
    const row = { id: item.id, productId: item.productId, text: item.text, rating: item.rating ?? null, expected: item.expected,
      metrics: { chunks: 0, cacheHit: false, usage: {}, responses: 0 },
      adjudication: { truePositives: null, falsePositives: null, falseNegatives: null, notes: '' } };
    try {
      const result = await extractReview({ userId: 'quality-evaluation', text: item.text, prompt: EXTRACTION_PROMPT,
        promptVersion: EXTRACTION_PROMPT_VERSION, methodVersion: EXTRACTION_METHOD_VERSION, modelVersion: 'unverified' }, provider, undefined, row.metrics);
      row.extracted = prepareExtraction(item.text, item.rating ?? null, result);
      row.status = 'succeeded';
      row.sentimentAllowed = item.expected?.sentiments?.includes(result.sentiment) ?? null;
      report.totals.succeeded++; report.totals.validatedQuotes += row.extracted.complaints.length;
    } catch (error) { row.status = 'failed'; row.errorCode = error.code ?? 'evaluation_error'; report.totals.failed++; }
    row.durationMs = Math.round(performance.now() - started); report.cases.push(row);
  }
  report.timing = { firstRequestMs: report.cases[0]?.durationMs ?? null,
    subsequentRequestMs: report.cases.slice(1).map(row => row.durationMs),
    totalMs: report.cases.reduce((sum, row) => sum + row.durationMs, 0),
    limitation: 'Runtime cold startup and peak GPU/RAM must be measured separately on the target PC.' };
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { dataset: { type: 'string', default: fileURLToPath(new URL('../docs/fixtures/review-cases.json', import.meta.url)) },
    output: { type: 'string', default: '.cache/model-evaluation.json' }, 'self-test': { type: 'boolean', default: false } } });
  if (values['self-test']) Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1',
    JWT_ACCESS_SECRET: 'evaluation-access-secret-xxxxxxxxxx', JWT_REFRESH_SECRET: 'evaluation-refresh-secret-xxxxxxxxxx', LLM_PROVIDER: 'local' });
  dotenv.config({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)), quiet: true });
  const { env } = await import('../apps/api/dist/config/env.js');
  const { createProvider, providerConfig, LlmError } = await import('../apps/api/dist/lib/llm.js');
  try {
    if (values['self-test']) {
      let request = 0;
      const report = await evaluateCases([1, 2, 3].map(id => ({ id, text: 'Крышка заедает', rating: 5 })), {
        config: { ...providerConfig(env), apiKey: 'never-export-this-key', baseUrl: 'http://never-export-this-host' },
        completeJson: async () => {
          if (++request === 2) throw new LlmError('invalid_response', 'Fixture failure');
          return { sentiment: 'positive', sentiment_score: 0.5, aspects: [{ name: 'качество', sentiment: 'negative' }],
            complaints: [{ aspectIndex: 0, scope: 'product', description: 'заедание', quote: request === 3 ? 'выдуманная цитата' : 'Крышка заедает', assertion: 'experienced', consequences: null }] };
        },
      });
      assert.deepEqual(report.totals, { total: 3, succeeded: 1, failed: 2, validatedQuotes: 1, precision: null, recall: null });
      assert(!JSON.stringify(report).includes('never-export'));
      console.log('Evaluation harness: validated quote, provider failure, invented quote, disabled cache, unknown semantic metrics and secret omission passed. No real model was evaluated.');
    } else {
      assert.equal(env.LLM_PROVIDER, 'local', 'Evaluation requires an explicitly configured local provider; cloud calls are refused');
      const provider = createProvider(providerConfig(env)); // Dedicated process, no API/worker semaphore or database writes.
      await provider.check(AbortSignal.timeout(10000));
      const dataset = JSON.parse(await fs.readFile(values.dataset, 'utf8'));
      assert(Array.isArray(dataset.cases) && dataset.cases.length > 0);
      const report = await evaluateCases(dataset.cases, provider, env.LLM_MODEL_VERSION);
      const output = path.resolve(values.output); await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ output, totals: report.totals, requiresHumanAdjudication: true }));
      if (report.totals.failed) process.exitCode = 1;
    }
  } finally { const { disconnectPrisma } = await import('../apps/api/dist/lib/prisma.js'); await disconnectPrisma(); }
}
