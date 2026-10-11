import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { parseWildberries } from './parsing.service.js';

afterEach(() => vi.unstubAllGlobals());

describe('parseWildberries', () => {
  it.each(['https://ozon.ru/product/12345', 'https://wildberries.ru/brand/nike', '', 'https://wildberries.ru/catalog/0/'])('отклоняет адрес без корректного артикула: %s', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(parseWildberries(url)).rejects.toThrow('Не удалось извлечь ID');
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
    vi.mocked(prisma.product.create).mockResolvedValue({ id: 'product-1' } as never);
    vi.mocked(prisma.review.createMany).mockResolvedValue({ count: 2 });
    expect(await parseWildberries(url)).toEqual({ source: 'wildberries', productId: 123456789, reviewsAdded: 2 });
    expect(prisma.review.createMany).toHaveBeenCalledWith({ data: [
      { text: 'Хороший товар\nПлюсы: Удобный\nМинусы: Шумит', rating: 4, reviewDate: new Date('2026-01-01T00:00:00Z'), productId: 'product-1' },
      { text: 'Без оценки', rating: null, reviewDate: null, productId: 'product-1' },
    ] });
  });

  it('не создаёт товар при отсутствии отзывов', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: string) => new Response(JSON.stringify(
      request.endsWith('card.json') ? { imt_id: 77 } : { feedbacks: [] },
    ), { status: 200 })));
    expect(await parseWildberries('https://wildberries.ru/catalog/123/detail.aspx')).toMatchObject({ reviewsAdded: 0 });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.review.createMany).not.toHaveBeenCalled();
  });
});
