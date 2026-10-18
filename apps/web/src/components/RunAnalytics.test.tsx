import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Change, RunAnalytics } from './RunAnalytics';
describe('analytics denominators and change meaning', () => {
  it('displays distinct successful and known-high-rating denominators and mixed aspects', () => {
    render(<RunAnalytics summary={{ total: 8, succeeded: 6, failed: 2, ratingSum: 20, ratingCount: 5, avgRating: 4, complaintCount: 3, complaintRate: .5,
      highRatedCount: 2, highRatedComplaintCount: 1, highRatedComplaintRate: .5,
      aspects: [{ category: 'quality', name: 'Крышка', reviews: 2, positive: 1, negative: 2, neutral: 0 }] }} />);
    expect(screen.getByText(/Среди успешно обработанных: 3\/6 · 50.0%/)).toBeInTheDocument();
    expect(screen.getByText(/оценкой 4–5: 1\/2 · 50.0%/)).toBeInTheDocument();
    expect(screen.getByText('2/6')).toBeInTheDocument();
  });
  it('uses red and an explicit label for worsening instead of coloring all increases green', () => {
    const { rerender } = render(<Change change={{ delta: .2, meaning: 'worsening' }} rate />);
    expect(screen.getByText('Ухудшение: +20.00 п.п.')).toHaveClass('text-red-700');
    rerender(<Change change={{ delta: null, meaning: 'unknown' }} rate />);
    expect(screen.getByText('Недостаточно данных')).toBeInTheDocument();
    expect(screen.queryByText(/п.п./)).not.toBeInTheDocument();
  });
});
