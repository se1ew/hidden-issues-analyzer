import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScopeCounts } from './ScopeCounts';
import type { OverviewStats } from '../lib/queries';
describe('run coverage labels', () => {
  it('keeps uploaded, run, successful and failed counts distinct', () => {
    render(<ScopeCounts stats={{ loadedTotal: 200, scopeTotal: 10, succeededCount: 7, failedCount: 2, remainingCount: 1, hasRun: true } as OverviewStats} />);
    expect(screen.getByText('200')).toBeInTheDocument(); expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Покрытие: 7\/10; осталось: 1/)).toBeInTheDocument();
  });
});
