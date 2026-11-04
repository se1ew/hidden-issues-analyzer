import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { seed: { type: 'string' }, cache: { type: 'string' } } });
const cache = path.resolve(values.cache ?? process.env.EMBEDDING_CACHE_DIR ?? 'models_cache');
const model = process.env.EMBEDDING_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const revision = process.env.EMBEDDING_REVISION ?? '2c4055b12046f11709e9df2c122e59ffbdc2f900';
assert(/^[a-f0-9]{40}$/i.test(revision), 'Set EMBEDDING_REVISION to a full commit before production startup');
const manifestFile = path.join(cache, 'embedding-assets.json');
async function manifestAt(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
await fs.mkdir(cache, { recursive: true });
let manifest = await manifestAt(manifestFile);
if (!manifest && values.seed) {
  const seed = path.resolve(values.seed);
  const candidate = await manifestAt(path.join(seed, 'embedding-assets.json'));
  if (candidate?.model === model && candidate?.revision === revision) {
    await fs.cp(seed, cache, { recursive: true, force: false, errorOnExist: false });
    manifest = await manifestAt(manifestFile);
  }
}
const offline = manifest?.model === model && manifest?.revision === revision;
console.log(offline ? 'Checking prepared embedding assets offline.' : 'First setup: downloading the pinned embedding model (about 135 MB).');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-embeddings.mjs', import.meta.url)),
  '--cache', cache, '--model', model, '--revision', revision, ...(offline ? ['--offline'] : [])],
{ stdio: 'inherit', windowsHide: true });
assert.equal(result.status, 0, 'Embedding setup failed. Check the connection on first setup or restore the verified embedding cache.');
