import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withLlmCapacity } from './llm-capacity.js';

const mocks = vi.hoisted(() => ({ eval: vi.fn(), zrem: vi.fn() }));
vi.mock('./analysis-queue.js', () => ({ getAnalysisQueue: () => ({ client: Promise.resolve(mocks) }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.eval.mockResolvedValue(1); mocks.zrem.mockResolvedValue(1); });

describe('shared model capacity lifecycle', () => {
  it('releases capacity even when inference fails', async () => {
    await expect(withLlmCapacity(async () => { throw new Error('provider failed'); }, new AbortController().signal)).rejects.toThrow('provider failed');
    expect(mocks.zrem).toHaveBeenCalledTimes(1);
  });
  it('cancels while waiting without starting inference', async () => {
    const controller = new AbortController(); const operation = vi.fn();
    mocks.eval.mockImplementation(async () => { controller.abort(); return 0; });
    await expect(withLlmCapacity(operation, controller.signal)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.zrem).not.toHaveBeenCalled();
  });
  it('fails closed if Redis cannot grant a permit', async () => {
    const operation = vi.fn(); mocks.eval.mockRejectedValue(new Error('Redis unavailable'));
    await expect(withLlmCapacity(operation, new AbortController().signal)).rejects.toThrow('Redis unavailable');
    expect(operation).not.toHaveBeenCalled();
  });
});
