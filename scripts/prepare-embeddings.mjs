import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const { values } = parseArgs({ options: {
  model: { type: 'string', default: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
  revision: { type: 'string' }, cache: { type: 'string', default: 'models_cache' },
  offline: { type: 'boolean', default: false },
} });
assert(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(values.model), 'Use an explicit organization/model identifier');
const cache = path.resolve(values.cache);
await fs.mkdir(cache, { recursive: true });
const manifestPath = path.join(cache, 'embedding-assets.json');
const saved = values.offline ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : undefined;
let revision = values.revision ?? saved?.revision;
if (!revision) {
  const response = await fetch(`https://huggingface.co/api/models/${values.model}`, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, 'Cannot resolve the model commit; provide a verified --revision');
  revision = (await response.json()).sha;
}
assert(/^[a-f0-9]{40}$/i.test(revision), 'Pin the full 40-character model commit');
const folder = path.join(cache, values.model, revision);
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
if (values.offline) {
  assert.equal(saved.model, values.model); assert.equal(saved.revision, revision);
  assert(saved.files.length > 0);
  for (const file of saved.files) {
    const resolved = path.resolve(cache, file.path);
    assert(resolved.startsWith(folder + path.sep), 'Manifest path escapes the model directory');
    assert((await fs.lstat(resolved)).isFile());
    assert.equal(await checksum(resolved), file.sha256, `Model checksum mismatch: ${file.path}`);
  }
  // A cached tokenizer or configuration must not silently make a network request.
  globalThis.fetch = async () => { throw new Error('Network access forbidden by offline model verification'); };
}
const { pipeline, env } = await import('@xenova/transformers');
env.cacheDir = cache; env.allowRemoteModels = !values.offline;
const started = performance.now();
const model = await pipeline('feature-extraction', values.model, { revision, quantized: true, cache_dir: cache, local_files_only: values.offline });
const output = await model(['Крышка заедает при открывании.', 'Крышку приходится открывать с усилием.'], { pooling: 'mean', normalize: true });
assert.equal(output.dims.length, 2); assert.equal(output.dims[0], 2); assert(output.dims[1] > 0);
assert([...output.data].every(Number.isFinite));
for (let row = 0; row < 2; row++) {
  const vector = output.data.slice(row * output.dims[1], (row + 1) * output.dims[1]);
  assert(Math.abs(Math.hypot(...vector) - 1) < 0.01);
}
const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Model assets must not be symbolic links');
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile()) files.push({ path: path.relative(cache, file).split(path.sep).join('/'), bytes: (await fs.stat(file)).size, sha256: await checksum(file) });
  }
}
await collect(folder);
if (!values.offline) await fs.writeFile(manifestPath, JSON.stringify({ model: values.model, revision, quantized: true, files }, null, 2));
await model.dispose();
console.log(JSON.stringify({ model: values.model, revision, cache, offline: values.offline, dimension: output.dims[1], files: files.length, durationMs: Math.round(performance.now() - started) }));
