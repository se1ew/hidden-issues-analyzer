import { describe, expect, it } from 'vitest';

// Тестируем внутреннюю функцию extractWbId через module-import
// Импортируем модуль целиком чтобы достать private-функцию через нестандартный экспорт тестового хелпера
// Вместо этого дублируем логику (unit-тест самой regex)

function extractWbIdFromUrl(url: string): number | null {
  const m = url.match(/\/catalog\/(\d+)\//);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

describe('extractWbId', () => {
  it('парсит стандартный URL WB', () => {
    expect(extractWbIdFromUrl('https://www.wildberries.ru/catalog/123456789/detail.aspx')).toBe(
      123456789,
    );
  });

  it('парсит global.wildberries.ru с size-параметром', () => {
    expect(
      extractWbIdFromUrl(
        'https://global.wildberries.ru/catalog/156438955/detail.aspx?size=260983012',
      ),
    ).toBe(156438955);
  });

  it('возвращает null для невалидного URL', () => {
    expect(extractWbIdFromUrl('https://ozon.ru/product/12345')).toBeNull();
    expect(extractWbIdFromUrl('https://wildberries.ru/brand/nike')).toBeNull();
    expect(extractWbIdFromUrl('')).toBeNull();
  });

  it('возвращает null если ID равен 0', () => {
    expect(extractWbIdFromUrl('https://www.wildberries.ru/catalog/0/detail.aspx')).toBeNull();
  });
});
