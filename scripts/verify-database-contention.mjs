import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const name = `hia-db-contention-${randomUUID().slice(0, 8)}`;
let baseline, application;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Docker ${args[0]} failed`);
  return result.stdout.trim();
}
async function contend(client, duration) {
  let entered;
  const acquired = new Promise(resolve => { entered = resolve; });
  const holder = client.$transaction(async tx => {
    entered(); await tx.$queryRaw`SELECT 1 FROM pg_sleep(${duration})`;
  });
  await acquired;
  const contender = client.$transaction(tx => tx.$queryRaw`SELECT 1 AS value`);
  const outcome = await Promise.allSettled([holder, contender]);
  return outcome;
}
try {
  docker(['run', '-d', '--name', name, '-e', 'POSTGRES_USER=check', '-e', 'POSTGRES_PASSWORD=check', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  let postgresReady = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'check']).status === 0) {
      postgresReady = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(postgresReady, 'Temporary PostgreSQL TCP listener did not become ready');
  const port = docker(['port', name, '5432']).split(':').at(-1);
  const url = `postgresql://check:check@127.0.0.1:${port}/check?connection_limit=1`;
  baseline = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const original = await contend(baseline, 3);
  assert.equal(original[0].status, 'fulfilled');
  assert.equal(original[1].status, 'rejected');
  assert.equal(original[1].reason.code, 'P2028');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url, REDIS_URL: 'redis://127.0.0.1:1',
    JWT_ACCESS_SECRET: 'contention-access-secret-xxxxxxxxxxx', JWT_REFRESH_SECRET: 'contention-refresh-secret-xxxxxxxxx', LLM_PROVIDER: 'local' });
  const { prisma } = await import('../apps/api/dist/lib/prisma.js'); application = prisma;
  const fixed = await contend(application, 6);
  assert(fixed.every(result => result.status === 'fulfilled'), 'Application transactions must survive connection contention and a 6-second callback');
  console.log('Database contention: reproduced baseline P2028 with one connection; application waited and committed both transactions without errors.');
} finally {
  await baseline?.$disconnect(); await application?.$disconnect();
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', windowsHide: true });
}
