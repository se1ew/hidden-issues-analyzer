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
          { text: 'Хороший товар', pros: 'Удобный', cons: 'Шумит', productValuation: 4, createdDate: '2026-01-01T00:00:00Z' },
          { text: 'Без оценки', productValuation: 0, createdDate: 'not-a-date' },
          { text: '   ' },
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

  it('не создаёт товар при отсутствии отзывов', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: string) => new Response(JSON.stringify(
      request.endsWith('card.json') ? { imt_id: 77 } : { feedbacks: [] },
    ), { status: 200 })));
    expect(await parseWildberries('https://wildberries.ru/catalog/123/detail.aspx', 'owner')).toMatchObject({ reviewsAdded: 0 });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.review.createMany).not.toHaveBeenCalled();
  });
});
