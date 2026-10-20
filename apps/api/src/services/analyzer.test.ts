import { beforeEach, describe, expect, it, vi } from 'vitest';
import { llm } from '../lib/llm.js';
import { analyzeReviewText } from './analyzer.service.js';

vi.mock('../lib/llm.js', async (original) => ({
  ...await original<typeof import('../lib/llm.js')>(),
  llm: { config: { provider: 'local', concurrency: 1, cloudDelayMs: 4000 }, completeJson: vi.fn() },
  waitForLlm: vi.fn(),
}));
const result = { sentiment: 'positive' as const, sentiment_score: 0.5, aspects: [], complaints: [] };
beforeEach(() => {
  vi.mocked(llm.completeJson).mockResolvedValue(result);
});

describe('provider integration in the existing analysis pipeline', () => {
  it('passes the entire source text and cancellation signal to the provider', async () => {
    const text = 'a'.repeat(4000); const controller = new AbortController();
    await analyzeReviewText(text, controller.signal);
    expect(llm.completeJson).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining(text) })]),
      schemaName: 'review_analysis',
    }), expect.anything(), controller.signal);
  });

});
