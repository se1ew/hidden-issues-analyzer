import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { llm, LlmError, waitForLlm } from '../lib/llm.js';
import { analyzeReviewText, runPendingAnalysis } from './analyzer.service.js';

vi.mock('../lib/llm.js', async (original) => ({
  ...await original<typeof import('../lib/llm.js')>(),
  llm: { config: { provider: 'local', concurrency: 1, cloudDelayMs: 4000 }, completeJson: vi.fn() },
  waitForLlm: vi.fn(),
}));
const result = { sentiment: 'positive' as const, sentiment_score: 0.5, aspects: [], issues: [] };
beforeEach(() => {
  vi.mocked(llm.completeJson).mockResolvedValue(result);
  vi.mocked(prisma.review.updateMany).mockResolvedValue({ count: 1 });
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

  it('does not impose the legacy four-second pause in local mode', async () => {
    vi.mocked(prisma.review.findMany).mockResolvedValue([{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }] as never);
    expect(await runPendingAnalysis({ userId: 'owner', delayMs: 60000 })).toEqual({ processed: 2, failed: 0, total: 2 });
    expect(waitForLlm).not.toHaveBeenCalled();
    expect(prisma.review.updateMany).toHaveBeenCalledTimes(2);
  });

  it('does not save failed output as a successful neutral review', async () => {
    vi.mocked(prisma.review.findMany).mockResolvedValue([{ id: 'a', text: 'First' }] as never);
    vi.mocked(llm.completeJson).mockRejectedValue(new LlmError('invalid_response', 'Некорректный результат'));
    expect(await runPendingAnalysis({ userId: 'owner' })).toEqual({ processed: 1, failed: 1, total: 1 });
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it('does not write a result after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(prisma.review.findMany).mockResolvedValue([{ id: 'a', text: 'First' }] as never);
    vi.mocked(llm.completeJson).mockImplementation(async () => { controller.abort(); return result; });
    await runPendingAnalysis({ userId: 'owner', signal: controller.signal });
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
  });
});
