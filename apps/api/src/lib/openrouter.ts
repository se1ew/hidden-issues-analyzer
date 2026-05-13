import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Минималистичный клиент OpenRouter, использующий нативный fetch (Node 20+).
 */
export async function chatCompletion(req: ChatCompletionRequest, _retries = 3): Promise<string> {
  const url = `${env.OPENROUTER_BASE_URL}/chat/completions`;
  const body = {
    model: env.OPENROUTER_MODEL,
    messages: req.messages,
    temperature: req.temperature ?? 0.2,
    max_tokens: req.max_tokens ?? 1024,
    ...(req.response_format ? { response_format: req.response_format } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': env.WEB_ORIGIN,
      'X-Title': 'Hidden Issues Analyzer',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const resetHeader = res.headers.get('X-RateLimit-Reset');
    const resetMs = resetHeader ? parseInt(resetHeader) : Date.now() + 60_000;
    const rawWaitMs = resetMs - Date.now();

    if (rawWaitMs > 120_000 || _retries <= 0) {
      const hoursLeft = Math.ceil(rawWaitMs / 3_600_000);
      const text = await res.text();
      logger.error({ waitMs: rawWaitMs, body: text.slice(0, 200) }, 'OpenRouter rate limit — daily cap exceeded');
      throw new Error(`Дневной лимит OpenRouter исчерпан, сброс через ~${hoursLeft} ч. Попробуйте позже.`);
    }

    const waitMs = Math.max(2_000, rawWaitMs + 500);
    logger.warn({ waitMs, retriesLeft: _retries }, 'Rate limited by OpenRouter, waiting...');
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return chatCompletion(req, _retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text.slice(0, 400) }, 'OpenRouter request failed');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  return content;
}

/**
 * Извлекает первый JSON-объект из ответа LLM (на случай, если модель добавила текст до/после).
 */
export function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in LLM response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
