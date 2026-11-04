import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createProvider, llm, LlmError, providerConfig, type ProviderConfig } from '../lib/llm.js';
import { HttpError } from '../middleware/error.js';

export const UpdateLlmSettingsSchema = z.object({
  provider: z.enum(['local', 'openrouter']),
  cloudModel: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9/._:+-]*$/).optional(),
  apiKey: z.string().trim().min(1).max(512).regex(/^[\x21-\x7e]+$/).optional(),
  clearApiKey: z.boolean().optional(),
}).strict().refine(input => !(input.apiKey && input.clearApiKey), 'Нельзя одновременно заменить и удалить ключ');

// Keys are bound to their owner and never stored in run snapshots or returned to the browser.
const encryptionKey = () => createHash('sha256').update('reviewlens-llm-settings-v1\0').update(env.JWT_REFRESH_SECRET).digest();
export function encryptApiKey(value: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptApiKey(value: string, userId: string) {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new HttpError(409, 'Не удалось прочитать ключ OpenRouter. Сохраните ключ заново в профиле.'); }
}

type LocalFile = { state: 'missing' | 'invalid' | 'present'; version?: string };
let cachedFile: { identity: string; result: Promise<LocalFile> } | undefined;
export async function localModelFile(): Promise<LocalFile | undefined> {
  const file = env.LOCAL_LLM_MODEL_FILE;
  if (!file) return undefined;
  let info;
  try { info = await stat(file, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    throw new HttpError(503, 'Не удалось прочитать папку локальной модели. Проверьте подключение models/llm.');
  }
  if (!info.isFile() || info.size < 8n) return { state: 'invalid' };
  const identity = `${file}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  if (cachedFile?.identity === identity) return cachedFile.result;
  const result = (async (): Promise<LocalFile> => {
    const handle = await open(file, 'r');
    try {
      const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0);
      if (header.toString('ascii') !== 'GGUF') return { state: 'invalid' };
    } finally { await handle.close(); }
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    const after = await stat(file, { bigint: true });
    if (after.size !== info.size || after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs) {
      throw new HttpError(409, 'Файл модели ещё копируется. Дождитесь завершения и повторите проверку.');
    }
    return { state: 'present', version: digest.digest('hex') };
  })();
  cachedFile = { identity, result };
  try { return await result; }
  catch (error) { if (cachedFile?.identity === identity) cachedFile = undefined; throw error; }
}

export async function savedLlmSettings(userId: string) {
  return prisma.userLlmSettings.findUnique({ where: { userId } });
}

export async function updateLlmSettings(userId: string, raw: unknown) {
  const input = UpdateLlmSettingsSchema.parse(raw);
  const current = await savedLlmSettings(userId);
  const cloudModel = input.cloudModel ?? current?.cloudModel ?? env.OPENROUTER_MODEL;
  const encryptedKey = input.clearApiKey ? null : input.apiKey ? encryptApiKey(input.apiKey, userId) : current?.encryptedKey ?? null;
  // An explicitly saved account never borrows another account's or the installation's cloud key.
  if (input.provider === 'openrouter' && !encryptedKey) throw new HttpError(422, 'Введите API-ключ OpenRouter.');
  await prisma.userLlmSettings.upsert({ where: { userId },
    create: { userId, provider: input.provider, cloudModel, encryptedKey },
    update: { provider: input.provider, cloudModel, encryptedKey } });
  return publicLlmSettings(userId);
}

export async function resolveLlmSettings(userId: string): Promise<{ config: ProviderConfig; modelVersion: string; credentialSource?: 'account' }> {
  const saved = await savedLlmSettings(userId);
  if (!saved && (env.LLM_PROVIDER !== 'local' || !env.LOCAL_LLM_MODEL_FILE)) {
    return { config: { ...llm.config }, modelVersion: env.LLM_MODEL_VERSION ?? 'unverified' };
  }
  const base = providerConfig(env);
  if (saved?.provider === 'openrouter') {
    if (!saved.encryptedKey) throw new HttpError(422, 'Сохраните API-ключ OpenRouter в профиле.');
    return { config: { ...base, provider: 'openrouter', baseUrl: env.OPENROUTER_BASE_URL,
      model: saved.cloudModel ?? env.OPENROUTER_MODEL, apiKey: decryptApiKey(saved.encryptedKey, userId) },
    modelVersion: 'unverified', credentialSource: 'account' };
  }
  return resolveLocalLlmSettings();
}

// Also used by the standalone evaluation harness; no user/database lookup.
export async function resolveLocalLlmSettings(): Promise<{ config: ProviderConfig; modelVersion: string }> {
  const base = providerConfig(env);
  const file = await localModelFile();
  if (file && file.state !== 'present') throw new LlmError('model_unavailable', file.state === 'missing'
    ? 'Скачайте GGUF-модель и поместите её в models/llm/model.gguf на компьютере с приложением.'
    : 'Файл models/llm/model.gguf не является GGUF-моделью. Проверьте скачанный файл.');
  return { config: { ...base, provider: 'local', apiKey: undefined,
    baseUrl: env.LOCAL_LLM_BASE_URL ?? (env.LLM_PROVIDER === 'local' ? base.baseUrl : 'http://127.0.0.1:8081/v1'),
    model: file ? `reviewlens-local-${file.version}` : env.LLM_PROVIDER === 'local' ? base.model : 'local-model',
    timeoutMs: Math.max(base.timeoutMs, 300_000), cloudDelayMs: 0,
  }, modelVersion: file?.version ?? env.LLM_MODEL_VERSION ?? 'unverified' };
}

export async function userLlmProvider(userId: string) {
  return createProvider((await resolveLlmSettings(userId)).config, true);
}

export async function runApiKey(userId: string, source?: 'account') {
  if (source !== 'account') return env.OPENROUTER_API_KEY;
  const saved = await savedLlmSettings(userId);
  if (!saved?.encryptedKey) throw new LlmError('model_unavailable', 'Ключ OpenRouter удалён. Сохраните ключ в профиле.');
  return decryptApiKey(saved.encryptedKey, userId);
}

export async function publicLlmSettings(userId: string) {
  const saved = await savedLlmSettings(userId);
  const file = await localModelFile();
  const provider = saved?.provider ?? llm.config.provider;
  return {
    provider,
    model: saved ? provider === 'openrouter' ? saved.cloudModel ?? env.OPENROUTER_MODEL
      : file ? 'model.gguf' : env.LLM_PROVIDER === 'local' ? llm.config.model : 'local-model'
      : provider === 'local' && file ? 'model.gguf' : llm.config.model,
    cloudModel: saved?.cloudModel ?? env.OPENROUTER_MODEL,
    hasApiKey: saved ? !!saved.encryptedKey : !!env.OPENROUTER_API_KEY,
    source: saved ? 'account' : 'installation',
    contextTokens: llm.config.contextTokens, concurrency: llm.config.concurrency, responseFormat: llm.config.responseFormat,
    local: { managed: !!file, file: 'models/llm/model.gguf', state: file?.state ?? 'external', backend: 'cpu' },
  };
}
