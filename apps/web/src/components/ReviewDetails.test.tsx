import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ReviewDetails } from './ReviewDetails';
import type { ReviewListItem } from '../lib/queries';
const review: ReviewListItem = { id: 'review', text: 'Хорошо, но крышка заедает.', rating: 5, reviewDate: null, source: 'csv', externalId: 'external',
  sentiment: 'positive', sentimentScore: 0.5, aspects: [{ name: 'Качество', sentiment: 'negative' }], issues: ['заедает'], hiddenIssueId: null, analyzedAt: '2026-10-18T10:00:00Z', createdAt: '2026-10-17T10:00:00Z', productId: 'p', product: null,
  analysisStatus: 'succeeded', evidence: [{ id: 'mention', defect: 'крышка заедает', quote: 'крышка заедает', quoteStart: 11, quoteEnd: 25, consequences: null,
    groupLinks: [{ id: 'snapshot', title: 'Крышка', productId: 'p', runId: 'run', publicationId: 'pub' }] }] };
describe('review metadata and evidence navigation', () => {
  it('preserves unknown dates, highlights the exact original quote and links its publication', () => {
    const { container } = render(<MemoryRouter><ReviewDetails review={review} /></MemoryRouter>);
    expect(container.querySelector('mark')?.textContent).toBe('крышка заедает');
    expect(screen.getByText('Не указана')).toBeInTheDocument();
    expect(screen.getByText(/CSV · ID: external/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть группу: Крышка' })).toHaveAttribute('href', '/issues?productId=p&runId=run&snapshotId=snapshot&publicationId=pub');
    expect(screen.queryByText(/0.5/)).not.toBeInTheDocument();
  });
  it('does not describe missing legacy evidence as a verified absence of problems', () => {
    render(<MemoryRouter><ReviewDetails review={{ ...review, analysisStatus: undefined, evidence: [] }} /></MemoryRouter>);
    expect(screen.getByText(/В старых данных есть жалобы без доказательств/)).toBeInTheDocument();
    expect(screen.queryByText('Жалобы с проверяемой цитатой не найдены.')).not.toBeInTheDocument();
  });
});
