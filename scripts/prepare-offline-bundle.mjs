import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { output: { type: 'string', default: '.cache/offline-bundle' },
  models: { type: 'string', default: '.cache/portable-models' }, 'skip-build': { type: 'boolean', default: false } } });
const output = path.resolve(values.output), models = path.resolve(values.models);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, `${command} ${args[0]} failed; see the command separately for diagnostics`);
  return result.stdout.trim();
}
const git = (...args) => run('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args]);
assert.equal(git('status', '--porcelain'), '', 'Commit and push all changes before preparing the final transfer bundle');
const commit = git('rev-parse', 'HEAD');
const assets = JSON.parse(await fs.readFile(path.join(models, 'embedding-assets.json'), 'utf8'));
assert(/^[a-f0-9]{40}$/.test(assets.revision));
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.mkdir(output);
await fs.mkdir(path.join(output, 'embeddings'));
async function hash(file) { const digest = createHash('sha256'); for await (const bytes of createReadStream(file)) digest.update(bytes); return digest.digest('hex'); }
for (const file of assets.files) {
  const source = path.resolve(models, file.path);
  assert(source.startsWith(models + path.sep), 'Model file escapes its cache directory');
  assert((await fs.lstat(source)).isFile()); assert.equal(await hash(source), file.sha256);
  const target = path.join(output, 'embeddings', file.path);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target, 1);
}
await fs.copyFile(path.join(models, 'embedding-assets.json'), path.join(output, 'embeddings', 'embedding-assets.json'), 1);
if (!values['skip-build']) run('docker', ['build', '--label', `org.opencontainers.image.revision=${commit}`, '-t', 'reviewlens-app:local', '.']);
const images = ['reviewlens-app:local', 'postgres:16-alpine', 'redis:7-alpine'];
const imageInfo = images.map(name => ({ name, id: run('docker', ['image', 'inspect', name, '--format', '{{.Id}}']) }));
run('docker', ['image', 'save', '--output', path.join(output, 'images.tar'), ...images]);
git('archive', '--format=zip', '--output', path.join(output, 'source.zip'), 'HEAD');
await fs.copyFile(path.join(root, 'scripts/verify-offline-bundle.ps1'), path.join(output, 'verify.ps1'), 1);
const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink());
    if (entry.isDirectory()) await collect(file);
    else files.push({ path: path.relative(output, file).split(path.sep).join('/'), bytes: (await fs.stat(file)).size, sha256: await hash(file) });
  }
}
await collect(output);
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, sourceCommit: commit, createdAt: new Date().toISOString(),
  platform: 'linux/amd64', images: imageInfo, embeddings: { model: assets.model, revision: assets.revision },
  excluded: ['user environments and secrets', 'user database and reports', 'target GPU runtime and instruct GGUF'], files }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, sourceCommit: commit, images: imageInfo.length, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
