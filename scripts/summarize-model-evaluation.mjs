import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function summarizeModelEvaluation(report) {
  assert.equal(
    report?.kind,
    'model-evaluation-requires-human-adjudication',
    'Expected a model evaluation report',
  );
  assert(
    typeof report.reviewedBy === 'string' && report.reviewedBy.trim(),
    'Fill in reviewedBy before scoring',
  );
  assert(Array.isArray(report.cases) && report.cases.length > 0, 'Expected at least one review');

  const ids = new Set();
  let succeeded = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let duplicatePredictions = 0;

  for (const row of report.cases) {
    assert(typeof row?.id === 'string' && row.id.trim(), 'Expected a nonempty review ID');
    const { id, status, expected, extracted, adjudication } = row;
    assert(!ids.has(id), `${id}: duplicate review ID`);
    ids.add(id);
    assert(Array.isArray(expected?.issues), `${id}: expected.issues must be an array`);
    assert(status === 'succeeded' || status === 'failed', `${id}: invalid status`);
    if (status === 'succeeded') {
      assert(Array.isArray(extracted?.complaints), `${id}: extracted.complaints must be an array`);
      succeeded++;
    } else {
      assert(extracted == null, `${id}: failed response cannot contain extracted results`);
    }

    for (const field of ['truePositives', 'falsePositives', 'falseNegatives']) {
      const count = adjudication?.[field];
      assert(
        Number.isSafeInteger(count) && count >= 0,
        `${id}: fill in adjudication.${field} with a nonnegative integer`,
      );
    }
    const {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      duplicatePredictions: duplicates = 0,
      notes,
    } = adjudication;
    const predicted = status === 'succeeded' ? extracted.complaints.length : 0;
    assert(
      Number.isSafeInteger(duplicates) && duplicates >= 0,
      `${id}: adjudication.duplicatePredictions must be a nonnegative integer`,
    );
    assert(
      tp + fn === expected.issues.length,
      `${id}: TP + FN must account for every expected defect`,
    );
    assert(
      tp + fp + duplicates === predicted,
      `${id}: TP + FP + duplicatePredictions must account for every published complaint`,
    );
    assert(
      duplicates === 0 || (typeof notes === 'string' && notes.trim()),
      `${id}: explain duplicate predictions in adjudication.notes`,
    );
    truePositives += tp;
    falsePositives += fp;
    falseNegatives += fn;
    duplicatePredictions += duplicates;
  }

  const total = report.cases.length;
  return {
    reviewedBy: report.reviewedBy.trim(),
    dataset: report.dataset ?? null,
    configuration: report.configuration ?? null,
    total,
    succeeded,
    failed: total - succeeded,
    successRate: succeeded / total,
    truePositives,
    falsePositives,
    falseNegatives,
    duplicatePredictions,
    precision:
      truePositives + falsePositives === 0
        ? null
        : truePositives / (truePositives + falsePositives),
    recall:
      truePositives + falseNegatives === 0
        ? null
        : truePositives / (truePositives + falseNegatives),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals } = parseArgs({ allowPositionals: true });
    assert.equal(
      positionals.length,
      1,
      'Usage: node scripts/summarize-model-evaluation.mjs PATH_TO_REVIEWED_REPORT.json',
    );
    const contents = await readFile(positionals[0], 'utf8');
    console.log(
      JSON.stringify(
        summarizeModelEvaluation(JSON.parse(contents.replace(/^\uFEFF/u, ''))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof SyntaxError ? 'Invalid JSON in evaluation report' : error.message,
    );
    process.exitCode = 1;
  }
}
