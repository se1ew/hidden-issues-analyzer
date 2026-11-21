import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { validateReviewCases } from './review-case-validation.mjs';

export async function evaluateCases(cases, provider, modelVersion = 'unverified', baseline = false, onCase = () => {}) {
  const { extractReview } = await import('../apps/api/dist/services/chunked-extraction.service.js');
  const { prepareExtraction, LEGACY_EXTRACTION_PROMPT, EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, EXTRACTION_METHOD_VERSION } = await import('../apps/api/dist/services/extraction.service.js');
  const prompt = baseline ? LEGACY_EXTRACTION_PROMPT : EXTRACTION_PROMPT;
  const promptVersion = baseline ? 'review-evidence-v3' : EXTRACTION_PROMPT_VERSION;
  const methodVersion = baseline ? 'extraction-v4' : EXTRACTION_METHOD_VERSION;
  const config = provider.config;
  const report = { capturedAt: new Date().toISOString(), kind: 'model-evaluation-requires-human-adjudication',
    reviewedBy: null, approvedThresholds: null,
    configuration: { provider: config.provider, model: config.model, modelVersion,
      contextTokens: config.contextTokens, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs,
      retries: config.retries, responseFormat: config.responseFormat, concurrency: 1,
      promptVersion, methodVersion, evidenceRepairBudget: baseline ? 0 : 1, cache: 'disabled-for-evaluation' },
    cases: [], totals: { total: cases.length, succeeded: 0, failed: 0, validatedQuotes: 0, precision: null, recall: null } };
  for (const item of cases) {
    const started = performance.now();
    const row = { id: item.id, productId: item.productId, text: item.text, rating: item.rating ?? null, expected: item.expected,
      metrics: { chunks: 0, cacheHit: false, usage: {}, responses: 0, repairs: 0 },
      adjudication: { truePositives: null, falsePositives: null, falseNegatives: null, notes: '' } };
    try {
      const result = await extractReview({ userId: 'quality-evaluation', text: item.text, prompt,
        promptVersion, methodVersion, modelVersion: 'unverified' }, provider, undefined, row.metrics);
      row.extracted = prepareExtraction(item.text, item.rating ?? null, result);
      row.status = 'succeeded';
      row.sentimentAllowed = item.expected?.sentiments?.includes(result.sentiment) ?? null;
      report.totals.succeeded++; report.totals.validatedQuotes += row.extracted.complaints.length;
    } catch (error) { row.status = 'failed'; row.errorCode = error.code ?? 'evaluation_error'; report.totals.failed++; }
    row.durationMs = Math.round(performance.now() - started); report.cases.push(row); onCase(row);
  }
  report.timing = { firstRequestMs: report.cases[0]?.durationMs ?? null,
    subsequentRequestMs: report.cases.slice(1).map(row => row.durationMs),
    totalMs: report.cases.reduce((sum, row) => sum + row.durationMs, 0),
    limitation: 'Runtime cold startup and peak GPU/RAM must be measured separately on the target PC.' };
  return report;
}

async function run() {
  const { values } = parseArgs({ options: { dataset: { type: 'string', default: fileURLToPath(new URL('../docs/fixtures/review-cases.json', import.meta.url)) },
    output: { type: 'string', default: '.cache/model-evaluation.json' }, baseline: { type: 'boolean', default: false }, 'self-test': { type: 'boolean', default: false },
    'validate-only': { type: 'boolean', default: false } } });
  assert(!(values['self-test'] && values['validate-only']), 'Choose either --self-test or --validate-only');
  const output = path.resolve(values.output);
  let dataset;
  let datasetIdentity;
  if (!values['self-test']) {
    const bytes = await fs.readFile(values.dataset);
    dataset = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
    validateReviewCases(dataset);
    datasetIdentity = { name: path.basename(values.dataset), sha256: createHash('sha256').update(bytes).digest('hex'), provenance: dataset.provenance ?? null };
    if (values['validate-only']) {
      console.log(JSON.stringify({ dataset: datasetIdentity, cases: dataset.cases.length }));
      return;
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    const existing = await fs.lstat(output).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    assert(!existing, `Output already exists: ${output}`);
  }
  if (values['self-test']) Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1',
    JWT_ACCESS_SECRET: 'evaluation-access-secret-xxxxxxxxxx', JWT_REFRESH_SECRET: 'evaluation-refresh-secret-xxxxxxxxxx', LLM_PROVIDER: 'local' });
  const { config: loadEnv } = await import('dotenv');
  loadEnv({ path: fileURLToPath(new URL('../apps/api/.env', import.meta.url)), quiet: true });
  const { env } = await import('../apps/api/dist/config/env.js');
  const { createProvider, providerConfig, LlmError } = await import('../apps/api/dist/lib/llm.js');
  try {
    if (values['self-test']) {
      let request = 0;
      const report = await evaluateCases([1, 2, 3].map(id => ({ id, text: 'Крышка заедает', rating: 5 })), {
        config: { ...providerConfig(env), apiKey: 'never-export-this-key', baseUrl: 'http://never-export-this-host' },
        completeJson: async (requestData) => {
          if (++request === 2) throw new LlmError('invalid_response', 'Fixture failure');
          return { sentiment: 'positive', sentiment_score: 0.5, aspects: [{ name: 'качество', sentiment: 'negative' }],
            complaints: [{ aspectIndex: 0, scope: 'product', description: 'заедание', quote: request >= 3 || requestData.disableRetries ? 'выдуманная цитата' : 'Крышка заедает', assertion: 'experienced', consequences: null }] };
        },
      });
      assert.deepEqual(report.totals, { total: 3, succeeded: 1, failed: 2, validatedQuotes: 1, precision: null, recall: null });
      assert(!JSON.stringify(report).includes('never-export'));
      console.log('Evaluation harness: validated quote, provider failure, invented quote, disabled cache, unknown semantic metrics and secret omission passed. No real model was evaluated.');
    } else {
      assert.equal(env.LLM_PROVIDER, 'local', 'Evaluation requires an explicitly configured local provider; cloud calls are refused');
      const { resolveLocalLlmSettings } = await import('../apps/api/dist/services/llm-settings.service.js');
      const selected = await resolveLocalLlmSettings();
      const provider = createProvider(selected.config); // Dedicated process, no API/worker semaphore or database writes.
      await provider.check(AbortSignal.timeout(10000));
      const report = await evaluateCases(dataset.cases, provider, selected.modelVersion, values.baseline,
        ({ id, status, errorCode, durationMs, metrics }) => console.log(JSON.stringify({ id, status, errorCode, durationMs, repairs: metrics.repairs })));
      report.dataset = datasetIdentity;
      await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ output, totals: report.totals, requiresHumanAdjudication: true }));
      if (report.totals.failed) process.exitCode = 1;
    }
  } finally { const { disconnectPrisma } = await import('../apps/api/dist/lib/prisma.js'); await disconnectPrisma(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid JSON in evaluation input' : error.message);
    process.exitCode = 1;
  }
}
