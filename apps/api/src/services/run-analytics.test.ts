import { describe, expect, it } from 'vitest';
import { calendarAnalytics, summarizeInputs, type AnalyticsInput } from './run-analytics.js';
const input = (date: string | null, rating: number | null, complaints = 0, status = 'succeeded'): AnalyticsInput => ({
  reviewDate: date ? new Date(date) : null, rating,
  analysis: { status, sentiment: 'positive', aspects: [], issues: Array.from({ length: complaints }, () => ({ scope: 'product' })) },
});
const run = { createdAt: new Date('2026-03-01'), finishedAt: new Date('2026-03-02T10:00Z'),
  scope: { mode: 'reanalyze', selection: { kind: 'all_reviews' }, limit: 200 } };
describe('calendar analytics from actual saved inputs', () => {
  it('counts unique reviews and keeps unknown ratings out of the high-rating denominator', () => {
    const rows = [input(null, 5, 3), input(null, 4), input(null, null, 1), input(null, 2, 1), input(null, 5, 1, 'failed')];
    rows[1].analysis!.issues.push({ scope: 'delivery' });
    expect(summarizeInputs(rows)).toMatchObject({ total: 5, succeeded: 4, failed: 1, complaintCount: 3, complaintRate: .75,
      highRatedCount: 2, highRatedComplaintCount: 1, highRatedComplaintRate: .5, ratingCount: 4, ratingSum: 16, avgRating: 4 });
  });
  it('counts repeated aspect/sentiment once, but preserves mixed sentiment for one aspect', () => {
    const row = input(null, null);
    row.analysis!.aspects = [{ category: 'quality', name: 'Крышка', sentiment: 'negative' }, { category: 'quality', name: 'Крышка', sentiment: 'negative' }, { category: 'quality', name: 'Крышка', sentiment: 'positive' }];
    expect(summarizeInputs([row]).aspects).toEqual([{ category: 'quality', name: 'Крышка', reviews: 1, negative: 1, positive: 1, neutral: 0 }]);
  });
  it('includes empty UTC days and excludes the end boundary and unknown dates', () => {
    const result = calendarAnalytics([input('2026-03-01T23:59:59Z', 5, 1), input('2026-03-02T00:00Z', 1, 1), input(null, 2)], run, 2);
    expect(result.buckets.map(row => row.date)).toEqual(['2026-02-28', '2026-03-01']);
    expect(result.buckets[0]).toMatchObject({ total: 0, avgRating: null, complaintRate: null });
    expect(result.comparison.current).toMatchObject({ total: 1, ratingSum: 5, avgRating: 5 });
    expect(result.unknownDateCount).toBe(1); expect(result.comparison.comparable).toBe(false);
  });
  it('uses weighted ratings when combining days or months', () => {
    const rows = [input('2026-02-28', 1), ...Array.from({ length: 9 }, () => input('2026-03-01', 5))];
    const result = calendarAnalytics(rows, run, 2, 'month');
    expect(result.buckets).toHaveLength(2); expect(result.comparison.current.avgRating).toBe(4.6);
    expect(result.comparison.current.ratingCount).toBe(10);
  });
  it('compares equal complete calendar windows and marks a complaint increase as worsening', () => {
    const rows = [...Array.from({ length: 5 }, () => input('2026-02-27', 5)), ...Array.from({ length: 5 }, () => input('2026-03-01', 1, 2))];
    const result = calendarAnalytics(rows, run, 2);
    expect(result.comparison.comparable).toBe(true);
    expect(result.comparison.complaintRate).toEqual({ delta: 1, meaning: 'worsening' });
    expect(result.comparison.avgRating).toEqual({ delta: -4, meaning: 'worsening' });
    expect(+new Date(result.comparison.current.to) - +new Date(result.comparison.current.from)).toBe(+new Date(result.comparison.previous.to) - +new Date(result.comparison.previous.from));
  });
  it('treats a decreasing complaint rate as improvement', () => {
    const rows = [...Array.from({ length: 5 }, () => input('2026-02-27', 1, 1)), ...Array.from({ length: 5 }, () => input('2026-03-01', 5))];
    expect(calendarAnalytics(rows, run, 2).comparison.complaintRate).toEqual({ delta: -1, meaning: 'improvement' });
  });
  it.each(['new_only', 'retry', 'capped', 'failed', 'outside'])('suppresses conclusions for %s data', reason => {
    const rows = [...Array.from({ length: 5 }, () => input('2026-02-27', 5)), ...Array.from({ length: 5 }, () => input('2026-03-01', 4, 1))];
    const scope = { ...run.scope, ...(reason === 'new_only' ? { mode: 'new_only' } : {}), ...(reason === 'retry' ? { retry: {} } : {}), ...(reason === 'capped' ? { limit: 10 } : {}), ...(reason === 'outside' ? { period: { from: '2026-02-28T00:00:00Z', to: '2026-03-02T00:00:00Z' } } : {}) };
    if (reason === 'failed') rows[0].analysis!.status = 'failed';
    const comparison = calendarAnalytics(rows, { ...run, scope }, 2).comparison;
    expect(comparison.comparable).toBe(false); expect(comparison.complaintRate.delta).toBeNull(); expect(comparison.reasons.length).toBeGreaterThan(0);
  });
  it('retains leap day and Monday week boundaries', () => {
    const leapRun = { ...run, finishedAt: new Date('2024-03-02T12:00Z') };
    const result = calendarAnalytics([input('2024-02-29', 5)], leapRun, 3, 'week');
    expect(result.buckets).toHaveLength(1); expect(result.buckets[0]).toMatchObject({ date: '2024-02-26', from: '2024-02-28T00:00:00.000Z', to: '2024-03-02T00:00:00.000Z', total: 1 });
  });
  it('excludes the unfinished run day from equal full-day windows', () => {
    const result = calendarAnalytics([input('2026-03-02T08:00Z', 1, 1), input('2026-03-01T23:59Z', 5)], run, 1);
    expect(result.comparison.current).toMatchObject({ from: '2026-03-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z', total: 1, avgRating: 5 });
    expect(result.buckets).toHaveLength(1);
  });
});
