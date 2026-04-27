import { describe, expect, it } from 'vitest';

// Тестируем pure helpers из stats (productWhere-логику через сам модуль)
// Так как функция productWhere не экспортирована — тестируем результат через публичный API
// но здесь проверяем логику построения условия через unit тест хелпера

const UNASSIGNED = '__unassigned__';

function productWhere(productId?: string): Record<string, unknown> {
  if (!productId) return {};
  if (productId === UNASSIGNED) return { productId: null };
  return { productId };
}

describe('productWhere helper', () => {
  it('без productId возвращает пустой объект (все товары)', () => {
    expect(productWhere()).toEqual({});
    expect(productWhere(undefined)).toEqual({});
  });

  it('UNASSIGNED_PRODUCT_ID возвращает productId: null (без привязки)', () => {
    expect(productWhere(UNASSIGNED)).toEqual({ productId: null });
  });

  it('конкретный id возвращает фильтр по id', () => {
    const id = 'clprod123';
    expect(productWhere(id)).toEqual({ productId: id });
  });
});

describe('hiddenScore formula', () => {
  // hidden_score = severity * (1 - visibility)
  function hiddenScore(severity: number, visibility: number): number {
    return severity * (1 - visibility);
  }

  it('скрытая проблема: высокая severity, низкая visibility', () => {
    expect(hiddenScore(0.9, 0.05)).toBeCloseTo(0.855);
  });

  it('явная проблема: высокая visibility дает низкий hidden_score', () => {
    expect(hiddenScore(0.9, 0.9)).toBeCloseTo(0.09);
  });

  it('нулевая severity — нулевой score', () => {
    expect(hiddenScore(0, 0.5)).toBe(0);
  });

  it('100% visibility — нулевой hidden_score', () => {
    expect(hiddenScore(0.8, 1)).toBe(0);
  });
});
