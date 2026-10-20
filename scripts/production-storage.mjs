import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, 'Docker storage command failed; no connection settings were printed');
  return result.stdout;
}
function commands(options) {
  const args = ['compose', '--env-file', path.resolve(options.envFile), '-f', path.join(root, 'compose.production.yaml'), '-p', options.project];
  return (...command) => {
    const result = spawnSync('docker', [...args, ...command], { cwd: root,
      env: { ...process.env, APP_ENV_FILE: path.resolve(options.envFile) }, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, `Production storage compose action failed: ${command[0]}`);
    return result.stdout.toString().trim();
  };
}
export async function backupProduction(options) {
  const compose = commands(options);
  const output = path.resolve(options.directory);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output); await fs.mkdir(path.join(output, 'reports'));
  const api = compose('ps', '-a', '-q', 'api');
  const postgres = compose('ps', '-a', '-q', 'postgres');
  assert(/^[a-f0-9]{12,64}$/.test(api) && /^[a-f0-9]{12,64}$/.test(postgres), 'Create the production project before backup');
  const running = compose('ps', '--status', 'running', '--services').split(/\s+/).filter(service => ['api', 'worker'].includes(service));
  try {
    // Quiesce writes and report expiry before taking a consistent DB + artifact copy.
    compose('stop', 'api', 'worker');
    const dump = docker(['exec', postgres, 'pg_dump', '-U', 'hia', '-d', 'hia_db', '--format=custom', '--no-owner', '--no-privileges']);
    await fs.writeFile(path.join(output, 'database.dump'), dump, { flag: 'wx' });
    docker(['cp', `${api}:/app/apps/api/reports_output/.`, path.join(output, 'reports')]);
    const files = [];
    for (const name of await fs.readdir(path.join(output, 'reports'))) {
      assert(/^[a-zA-Z0-9._-]+$/.test(name), 'Unexpected artifact name');
      const file = path.join(output, 'reports', name);
      assert((await fs.lstat(file)).isFile(), 'Only regular artifact files can be backed up');
      const bytes = await fs.readFile(file);
      files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
    }
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(),
      databaseSha256: digest(dump), files }, null, 2), { flag: 'wx' });
  } finally { if (running.length) compose('start', ...running); }
}
export async function restoreProduction(options) {
  const compose = commands(options);
  const input = path.resolve(options.directory);
  const manifest = JSON.parse(await fs.readFile(path.join(input, 'manifest.json'), 'utf8'));
  const dump = await fs.readFile(path.join(input, 'database.dump'));
  assert.equal(manifest.version, 1); assert.equal(digest(dump), manifest.databaseSha256, 'Database checksum mismatch');
  for (const file of manifest.files) {
    assert(/^[a-zA-Z0-9._-]+$/.test(file.name) && !['.', '..'].includes(file.name), 'Unsafe artifact name');
    const name = path.join(input, 'reports', file.name);
    assert((await fs.lstat(name)).isFile());
    const bytes = await fs.readFile(name);
    assert.equal(bytes.length, file.bytes); assert.equal(digest(bytes), file.sha256, 'Artifact checksum mismatch');
  }
  assert.deepEqual((await fs.readdir(path.join(input, 'reports'))).sort(), manifest.files.map(file => file.name).sort(), 'Unlisted artifact in backup');
  const running = compose('ps', '--status', 'running', '--services').split(/\s+/);
  assert(!running.includes('api') && !running.includes('worker'), 'Stop API and worker before restoring to an empty database');
  compose('up', '-d', '--wait', '--wait-timeout', '90', 'postgres');
  const postgres = compose('ps', '-a', '-q', 'postgres');
  const count = docker(['exec', postgres, 'psql', '-X', '-U', 'hia', '-d', 'hia_db', '-Atc', "SELECT count(*) FROM pg_tables WHERE schemaname='public'"]).toString().trim();
  assert.equal(count, '0', 'Restore target must be an empty database; existing data will not be overwritten');
  compose('create', '--no-build', 'api', 'worker');
  compose('run', '--rm', '--no-deps', '-T', 'api', 'node', '-e', "if(require('node:fs').readdirSync('/app/apps/api/reports_output').length)process.exit(1)");
  docker(['exec', '-i', postgres, 'pg_restore', '-U', 'hia', '-d', 'hia_db', '--single-transaction', '--no-owner', '--no-privileges'], dump);
  const api = compose('ps', '-a', '-q', 'api');
  docker(['cp', path.join(input, 'reports') + path.sep + '.', `${api}:/app/apps/api/reports_output/`]);
  docker(['exec', postgres, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'hia', '-d', 'hia_db', '-c',
    `DELETE FROM "ServiceHeartbeat"; UPDATE "Report" SET status='queued', "leaseExpiresAt"=NULL WHERE status='running'; UPDATE "AnalysisRun" SET "leaseExpiresAt"='1970-01-01' WHERE status='running';`]);
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    directory: { type: 'string' }, 'env-file': { type: 'string', default: path.join(root, 'deploy/.env') },
    project: { type: 'string', default: 'reviewlens' },
  } });
  assert(values.directory && ['backup', 'restore'].includes(positionals[0]), 'Use backup|restore --directory PATH [--env-file PATH] [--project NAME]');
  assert(/^[a-z0-9][a-z0-9_-]{0,60}$/.test(values.project), 'Invalid project name');
  const options = { directory: values.directory, envFile: values['env-file'], project: values.project };
  if (positionals[0] === 'backup') await backupProduction(options); else await restoreProduction(options);
  console.log(`Production ${positionals[0]} completed with verified checksums.`);
}
