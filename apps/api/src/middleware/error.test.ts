import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler, notFound, HttpError } from './error.js';
const app = express(); app.use(express.json({ limit: '1kb' }));
app.get('/conflict', () => { throw new HttpError(409, 'Обновите данные', undefined, 'scope_mismatch'); });
app.get('/validation', () => { z.object({ page: z.number() }).parse({ page: 'invalid' }); });
app.get('/internal', () => { throw new Error('secret-internal-path'); });
app.post('/body', (_req, res) => { res.json({ ok: true }); });
app.use(notFound); app.use(errorHandler);
describe('uniform API error envelope', () => {
  it.each([['/missing', 404, 'not_found'], ['/conflict', 409, 'scope_mismatch'], ['/validation', 422, 'validation_failed'], ['/internal', 500, 'internal_error']] as const)('returns %s with safe stable code', async (path, status, code) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(status); expect(res.body.code).toBe(code);
    expect(res.body.message).toBe(res.body.error); expect(JSON.stringify(res.body)).not.toContain('secret-internal-path');
  });
  it('normalizes malformed JSON and oversized requests', async () => {
    expect((await request(app).post('/body').type('json').send('{bad')).body.code).toBe('bad_request');
    expect((await request(app).post('/body').send({ text: 'a'.repeat(2000) })).body.code).toBe('payload_too_large');
  });
});
