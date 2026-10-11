import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../docs/fixtures/review-cases.json', import.meta.url), 'utf8'));
const categories = new Set(['quality', 'functionality', 'material', 'size_fit', 'appearance', 'usability', 'price', 'delivery', 'seller', 'packaging', 'other']);
const scopes = new Set(['product', 'delivery', 'seller', 'packaging']);
const sentiments = new Set(['positive', 'negative', 'neutral']);
const ids = new Set();
const actualGroups = new Map();

for (const item of data.cases) {
  assert.equal(typeof item.id, 'string');
  assert(!ids.has(item.id), `Duplicate ID: ${item.id}`);
  ids.add(item.id);
  assert.equal(typeof item.productId, 'string');
  assert(item.text.trim().length > 0, `${item.id}: empty text`);
  assert(item.rating === null || (Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5), `${item.id}: rating`);
  assert(item.expected.sentiments.length > 0);
  for (const sentiment of item.expected.sentiments) {
    assert(sentiments.has(sentiment), `${item.id}: sentiment`);
    assert.equal(item.expected.positiveContext, (item.rating !== null && item.rating >= 4) || sentiment === 'positive', `${item.id}: ambiguous positive context`);
  }
  if (item.expected.ratingSentimentConflict) {
    assert(item.rating >= 4 && item.expected.sentiments.every(s => s === 'negative'), `${item.id}: conflict`);
  }
  const seen = new Set();
  for (const issue of item.expected.issues) {
    assert(categories.has(issue.aspect), `${item.id}: aspect`);
    assert(scopes.has(issue.scope), `${item.id}: scope`);
    assert(issue.quote.length > 0 && item.text.includes(issue.quote), `${item.id}: quote is not verbatim`);
    const issueKey = `${issue.scope}:${issue.defect}`;
    assert(!seen.has(issueKey), `${item.id}: repeated expected defect`);
    seen.add(issueKey);
    if (issue.scope !== 'product') continue;
    const key = `${item.productId}:${issue.defect}`;
    const group = actualGroups.get(key) ?? { productId: item.productId, defect: issue.defect, reviewIds: [], positiveReviewIds: [], unratedPositiveReviewIds: [] };
    group.reviewIds.push(item.id);
    if (item.expected.positiveContext) {
      group.positiveReviewIds.push(item.id);
      if (item.rating === null) group.unratedPositiveReviewIds.push(item.id);
    }
    actualGroups.set(key, group);
  }
}

const groupKeys = new Set();
for (const expected of data.expectedProductGroups) {
  const key = `${expected.productId}:${expected.defect}`;
  assert(!groupKeys.has(key), `Duplicate group: ${key}`);
  groupKeys.add(key);
  const actual = actualGroups.get(key);
  assert(actual, `Unknown group: ${key}`);
  for (const field of ['reviewIds', 'positiveReviewIds', 'unratedPositiveReviewIds']) {
    assert.deepEqual([...expected[field]].sort(), [...actual[field]].sort(), `${key}: ${field}`);
  }
  assert.equal(expected.hidden, actual.positiveReviewIds.length >= 2, `${key}: hidden`);
}
assert.equal(groupKeys.size, actualGroups.size, 'Missing expected groups');
console.log(`Validated ${ids.size} reviews, ${groupKeys.size} product groups, ${data.expectedProductGroups.filter(g => g.hidden).length} hidden groups. Dataset validation only; model not evaluated.`);
