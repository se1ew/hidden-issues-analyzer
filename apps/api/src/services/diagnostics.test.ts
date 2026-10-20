import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedCheck, readiness } from './diagnostics.service.js';
const mocks = vi.hoisted(() => ({ db: vi.fn(), worker: vi.fn(), ping: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.db, serviceHeartbeat: { findFirst: mocks.worker } } }));
vi.mock('../lib/analysis-queue.js', () => ({ getAnalysisQueue: () => ({ client: Promise.resolve({ ping: mocks.ping }) }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.db.mockResolvedValue([1]); mocks.worker.mockResolvedValue({ id: 'worker' }); mocks.ping.mockResolvedValue('PONG'); });
describe('independent application readiness', () => {
  it('does not probe the model or claim its availability', async () => {
    expect(await readiness()).toMatchObject({ status: 'ready', database: true, queue: true, worker: true, model: { state: 'unchecked' } });
  });
  it.each(['database', 'queue', 'worker'])('reports unavailable %s without hiding other dependencies', async component => {
    if (component === 'database') mocks.db.mockRejectedValue(new Error('private connection URL'));
    if (component === 'queue') mocks.ping.mockRejectedValue(new Error('private Redis password'));
    if (component === 'worker') mocks.worker.mockResolvedValue(null);
    const result = await readiness(); expect(result.status).toBe('degraded'); expect(result[component as 'database' | 'queue' | 'worker']).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private/);
  });
  it('bounds a hung probe instead of hanging a readiness request', async () => {
    expect(await boundedCheck(() => new Promise(() => undefined), 10)).toBe(false);
  });
});
