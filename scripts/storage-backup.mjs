import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeKey = key => typeof key === 'string' && /^report-[a-zA-Z0-9-]+\.(pdf|docx)$/.test(key);
function docker(args, output) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let bytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.on('error', () => reject(new Error('Docker command unavailable')));
    child.on('close', async code => {
      if (code !== 0 || bytes > 256 * 1024 * 1024) return reject(new Error('Database backup/restore command failed'));
      const buffer = Buffer.concat(chunks);
      if (output) await fs.writeFile(output, buffer, { flag: 'wx' });
      resolve(buffer);
    });
    // Consume stderr without exposing connection strings or database contents.
    child.stderr.resume();
  });
}
export async function backupStorage({ databaseUrl, container, output, reportsDir }) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Only a local Docker database is supported');
  await fs.mkdir(output, { recursive: false }); await fs.mkdir(path.join(output, 'reports'));
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(8018214)`;
      const [{ snapshot }] = await tx.$queryRaw`SELECT pg_export_snapshot() AS snapshot`;
      const reports = await tx.report.findMany({ where: { status: 'completed' } });
      const manifest = { version: 1, createdAt: new Date().toISOString(), reports: [] };
      for (const report of reports) {
        const key = report.artifactKey ?? path.basename(report.filePath);
        if (!safeKey(key) || path.dirname(path.resolve(report.filePath)) !== path.resolve(reportsDir)) throw new Error('Report is outside the configured storage');
        const stat = await fs.lstat(report.filePath); if (!stat.isFile()) throw new Error('Report must be a regular file');
        const bytes = await fs.readFile(report.filePath);
        await fs.writeFile(path.join(output, 'reports', key), bytes, { flag: 'wx' });
        manifest.reports.push({ id: report.id, key, sha256: digest(bytes), bytes: bytes.length });
      }
      const dump = await docker(['exec', container, 'pg_dump', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1)), '--no-owner', '--no-privileges', '--format=custom', `--snapshot=${snapshot}`], path.join(output, 'database.dump'));
      manifest.databaseSha256 = digest(dump);
      await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    }, { isolationLevel: 'RepeatableRead', timeout: 300000 });
  } finally { await db.$disconnect(); }
}
export async function restoreStorage({ databaseUrl, container, input, reportsDir }) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Restore requires a local database');
  const manifest = JSON.parse(await fs.readFile(path.join(input, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || digest(await fs.readFile(path.join(input, 'database.dump'))) !== manifest.databaseSha256) throw new Error('Invalid backup manifest or database checksum');
  for (const report of manifest.reports) {
    if (!safeKey(report.key) || digest(await fs.readFile(path.join(input, 'reports', report.key))) !== report.sha256) throw new Error('Invalid report key or checksum');
  }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  try {
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    if (tables.length) throw new Error('Restore target must be an empty database; existing tables will not be overwritten');
    await fs.mkdir(reportsDir, { recursive: true });
    if ((await fs.readdir(reportsDir)).length) throw new Error('Restore report directory must be empty');
    const temp = `/tmp/hia-restore-${Date.now()}.dump`;
    try {
      await docker(['cp', path.resolve(input, 'database.dump'), `${container}:${temp}`]);
      await docker(['exec', container, 'pg_restore', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1)), '--no-owner', '--no-privileges', '--single-transaction', temp]);
    } finally { await docker(['exec', container, 'rm', '-f', temp]); }
    for (const report of manifest.reports) {
      const filePath = path.join(path.resolve(reportsDir), report.key);
      await fs.copyFile(path.join(input, 'reports', report.key), filePath, 1);
      await db.report.update({ where: { id: report.id }, data: { filePath, artifactKey: report.key } });
    }
    // Active leases belong to the old process and must never appear healthy after restore.
    await db.serviceHeartbeat.deleteMany();
    await db.report.updateMany({ where: { status: 'running' }, data: { status: 'queued', leaseExpiresAt: null } });
    await db.analysisRun.updateMany({ where: { status: 'running' }, data: { leaseExpiresAt: new Date(0) } });
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ path: path.join(root, 'apps/api/.env'), quiet: true });
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { container: { type: 'string', default: 'hia-postgres' }, directory: { type: 'string' }, reports: { type: 'string', default: path.join(root, 'apps/api/reports_output') } } });
  if (!values.directory || !['backup', 'restore'].includes(positionals[0])) throw new Error('Use backup|restore --directory <new-backup-or-existing-backup> [--container name] [--reports dir]');
  const options = { databaseUrl: process.env.DATABASE_URL, container: values.container, reportsDir: values.reports };
  if (positionals[0] === 'backup') await backupStorage({ ...options, output: path.resolve(values.directory) });
  else await restoreStorage({ ...options, input: path.resolve(values.directory) });
  console.log('Storage operation completed; checksums verified.');
}
