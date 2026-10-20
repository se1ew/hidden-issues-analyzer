import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { persistImport } from './imports.service.js';
vi.mock('./imports.service.js', () => ({ persistImport: vi.fn() }));
import { parseWildberries } from './parsing.service.js';

afterEach(() => vi.unstubAllGlobals());

describe('parseWildberries', () => {
  it.each(['https://ozon.ru/product/12345', 'https://wildberries.ru/brand/nike', '', 'https://wildberries.ru/catalog/0/'])('отклоняет адрес без корректного артикула: %s', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(parseWildberries(url, 'owner')).rejects.toThrow('Не удалось извлечь ID');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it.each(['https://www.wildberries.ru/catalog/123456789/detail.aspx', 'https://global.wildberries.ru/catalog/123456789/detail.aspx?size=260983012'])('импортирует отзывы через реальный парсер: %s', async (url) => {
    vi.stubGlobal('fetch', vi.fn(async (request: string) => new Response(JSON.stringify(
      request.endsWith('card.json') ? { imt_id: 77 } : {
        feedbacks: [
          { id: 'a', productDetails: { nmId: 123456789 }, text: 'Хороший товар', pros: 'Удобный', cons: 'Шумит', productValuation: 4, createdDate: '2026-01-01T00:00:00Z' },
          { id: 'b', productDetails: { nmId: 123456789 }, text: 'Без оценки', productValuation: 0, createdDate: 'not-a-date' },
          { id: 'c', productDetails: { nmId: 123456789 }, text: '   ' },
        ],
      },
    ), { status: 200 })));
    vi.mocked(persistImport).mockResolvedValue({ count: 2, productId: 'product-1', batchId: 'batch-1', skippedCount: 0,
      totalCount: 2, validCount: 2, errorCount: 0, status: 'completed', reviewIds: [] });
    expect(await parseWildberries(url, 'owner')).toMatchObject({ source: 'wildberries', productId: 123456789, reviewsAdded: 2, batchId: 'batch-1' });
    expect(persistImport).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner',
      productExternalId: '123456789', externalSource: 'wildberries', rows: [
        expect.objectContaining({ text: 'Хороший товар\nПлюсы: Удобный\nМинусы: Шумит', rating: 4, date: new Date('2026-01-01T00:00:00Z') }),
        expect.objectContaining({ text: 'Без оценки', rating: undefined, date: undefined }),
      ] }));
  });

  it('reports a changed source format instead of pretending the product has no reviews', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('card.json') ? { imt_id: 77 } : { unexpected: [] }))));
    await expect(parseWildberries('https://wildberries.ru/catalog/123/detail.aspx', 'owner')).rejects.toMatchObject({ status: 503, code: 'source_format_changed' });
    expect(persistImport).not.toHaveBeenCalled();
  });
  it.each(['https://evil.test/catalog/123/detail.aspx', 'https://wildberries.ru.evil.test/catalog/123/detail.aspx', 'https://a:b@wildberries.ru/catalog/123/detail.aspx', '9007199254740993'])('rejects an unsafe or imprecise identity %s', async url => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(parseWildberries(url, 'owner')).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('stops after three probes, accepts an article number and never mixes sibling products', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('card.json') ? { imt_id: 77 } : { feedbacks: [
      { id: 'same', productDetails: { nmId: 123 }, text: 'Наш отзыв' },
      { id: 'other', productDetails: { nmId: 124 }, text: 'Чужой вариант' },
    ] })));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(persistImport).mockResolvedValue({ count: 1, productId: 'p', batchId: 'b', skippedCount: 0, totalCount: 1, validCount: 1, errorCount: 0, status: 'completed', reviewIds: [] });
    expect(await parseWildberries('123', 'owner')).toMatchObject({ receivedCount: 2, ignoredCount: 1, historyComplete: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(persistImport).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ externalId: 'same', text: 'Наш отзыв' })] }));
  });
  it('starts no source request after cancellation', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(parseWildberries('123', 'owner', { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'source_cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses an unidentified sibling instead of claiming a successful empty import', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('card.json') ? { imt_id: 77 } : { feedbacks: [{ id: 'x', text: 'Без артикула' }] }))));
    await expect(parseWildberries('123', 'owner')).rejects.toMatchObject({ code: 'source_format_changed' });
    expect(persistImport).not.toHaveBeenCalled();
  });
  it('не создаёт товар при отсутствии отзывов', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: string) => new Response(JSON.stringify(
      request.endsWith('card.json') ? { imt_id: 77 } : { feedbacks: [] },
    ), { status: 200 })));
    expect(await parseWildberries('https://wildberries.ru/catalog/123/detail.aspx', 'owner')).toMatchObject({ reviewsAdded: 0 });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.review.createMany).not.toHaveBeenCalled();
  });
});
