import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, 'apps/api/.env'), quiet: true });
const { values } = parseArgs({ options: { container: { type: 'string', default: 'hia-postgres' } } });
const source = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'This command backs up only a local Docker database');
const result = spawnSync('docker', ['exec', values.container, 'pg_dump', '-U', decodeURIComponent(source.username),
  '-d', decodeURIComponent(source.pathname.slice(1)), '--no-owner', '--no-privileges', '--format=custom'], { maxBuffer: 256 * 1024 * 1024 });
assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message || 'pg_dump failed');
assert(result.stdout.length > 0, 'Dump must not be empty');
const folder = path.join(root, '.cache/backups');
fs.mkdirSync(folder, { recursive: true });
const output = path.join(folder, `before-domain-${new Date().toISOString().replaceAll(':', '-')}.dump`);
fs.writeFileSync(output, result.stdout, { flag: 'wx' });
console.log(`Saved local database backup: ${output}`);
