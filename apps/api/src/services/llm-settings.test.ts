import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { signAccessToken } from '../middleware/auth.js';
import { errorHandler } from '../middleware/error.js';
import { analysisRouter } from '../routes/analysis.routes.js';
import { decryptApiKey, encryptApiKey, localModelFile, publicLlmSettings, resolveLlmSettings, runApiKey, updateLlmSettings } from './llm-settings.service.js';

const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { userLlmSettings: { findUnique: mocks.find, upsert: mocks.upsert } } }));
const app = express(); app.use(express.json()); app.use('/api/analysis', analysisRouter); app.use(errorHandler);
const token = signAccessToken({ sub: 'owner', email: 'owner@test.local' });
const records = new Map<string, { userId: string; provider: string; cloudModel?: string; encryptedKey?: string | null }>();
let folder: string | undefined;
beforeEach(() => {
  records.clear();
  mocks.find.mockImplementation(({ where }) => Promise.resolve(records.get(where.userId) ?? null));
  mocks.upsert.mockImplementation(({ where, create, update }) => {
    const record = records.has(where.userId) ? { ...records.get(where.userId), ...update } : create;
    records.set(where.userId, record); return Promise.resolve(record);
  });
});
afterEach(async () => {
  delete env.LOCAL_LLM_MODEL_FILE; delete env.LOCAL_LLM_BASE_URL;
  if (folder) await rm(folder, { recursive: true, force: true }); folder = undefined;
});

describe('account model settings', () => {
  it('encrypts a key with owner-bound authenticated encryption', () => {
    const encrypted = encryptApiKey('private-key', 'owner');
    expect(encrypted).not.toContain('private-key');
    expect(decryptApiKey(encrypted, 'owner')).toBe('private-key');
    expect(() => decryptApiKey(encrypted, 'other')).toThrow('Сохраните ключ заново');
    expect(encryptApiKey('private-key', 'owner')).not.toBe(encrypted);
  });
  it('requires authentication and never returns the saved key or ciphertext', async () => {
    expect((await request(app).put('/api/analysis/provider').send({ provider: 'local' })).status).toBe(401);
    const response = await request(app).put('/api/analysis/provider').auth(token, { type: 'bearer' })
      .send({ provider: 'openrouter', cloudModel: 'vendor/model', apiKey: 'private-api-key' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ provider: 'openrouter', model: 'vendor/model', hasApiKey: true, source: 'account' });
    expect(JSON.stringify(response.body)).not.toMatch(/private-api-key|encryptedKey|apiKey|baseUrl/);
    expect(records.get('owner')?.encryptedKey).not.toBe('private-api-key');
  });
  it('keeps another account on its own settings and does not borrow the installation key when saving', async () => {
    await updateLlmSettings('owner', { provider: 'openrouter', cloudModel: 'vendor/model', apiKey: 'owner-key' });
    expect((await resolveLlmSettings('owner')).config).toMatchObject({ provider: 'openrouter', model: 'vendor/model', apiKey: 'owner-key' });
    expect((await resolveLlmSettings('other')).config.provider).toBe('local');
    await expect(updateLlmSettings('other', { provider: 'openrouter' })).rejects.toMatchObject({ status: 422 });
    expect(await runApiKey('owner', 'account')).toBe('owner-key');
    await expect(runApiKey('other', 'account')).rejects.toMatchObject({ code: 'model_unavailable' });
  });
  it('retains the account key while switching local and can explicitly remove it', async () => {
    await updateLlmSettings('owner', { provider: 'openrouter', cloudModel: 'vendor/first', apiKey: 'owner-key' });
    await updateLlmSettings('owner', { provider: 'local' });
    expect((await resolveLlmSettings('owner')).config).toMatchObject({ provider: 'local', apiKey: undefined });
    expect(await runApiKey('owner', 'account')).toBe('owner-key');
    await updateLlmSettings('owner', { provider: 'local', clearApiKey: true });
    await expect(updateLlmSettings('owner', { provider: 'openrouter' })).rejects.toMatchObject({ status: 422 });
  });
  it('exposes the same strict output mode that a free-router run will save', async () => {
    await updateLlmSettings('owner', { provider: 'openrouter', cloudModel: 'openrouter/free', apiKey: 'owner-key' });
    expect((await resolveLlmSettings('owner')).config).toMatchObject({ model: 'openrouter/free', responseFormat: 'json_schema' });
    expect(await publicLlmSettings('owner')).toMatchObject({ model: 'openrouter/free', responseFormat: 'json_schema' });
  });
  it('rejects injected owner, URL and conflicting key changes', async () => {
    for (const extra of [{ userId: 'other' }, { baseUrl: 'http://foreign' }, { apiKey: 'new', clearApiKey: true }]) {
      expect((await request(app).put('/api/analysis/provider').auth(token, { type: 'bearer' }).send({ provider: 'local', ...extra })).status).toBe(422);
    }
  });
  it('distinguishes missing and invalid GGUF and identifies model changes by their bytes', async () => {
    folder = await mkdtemp(join(tmpdir(), 'reviewlens-model-test-'));
    env.LOCAL_LLM_MODEL_FILE = join(folder, 'model.gguf');
    env.LOCAL_LLM_BASE_URL = 'http://local-llm:8081/v1';
    await updateLlmSettings('owner', { provider: 'local' });
    expect(await localModelFile()).toEqual({ state: 'missing' });
    await expect(resolveLlmSettings('owner')).rejects.toMatchObject({ code: 'model_unavailable' });
    await writeFile(env.LOCAL_LLM_MODEL_FILE, 'not a gguf model');
    expect(await localModelFile()).toEqual({ state: 'invalid' });
    await writeFile(env.LOCAL_LLM_MODEL_FILE, 'GGUF\x03\0\0\0first fixture');
    const first = await resolveLlmSettings('owner');
    expect(first.config.baseUrl).toBe('http://local-llm:8081/v1');
    expect(first.config.model).toBe(`reviewlens-local-${first.modelVersion}`);
    await writeFile(env.LOCAL_LLM_MODEL_FILE, 'GGUF\x03\0\0\0second fixture');
    expect((await resolveLlmSettings('owner')).modelVersion).not.toBe(first.modelVersion);
  });
});
