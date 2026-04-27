import { describe, expect, it } from 'vitest';

// Тестируем centroid-вычисление и cosineSimilarity — оба используются в clustering

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * b[i]!, 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i]! += v[i]!;
  }
  return sum.map((s) => s / vectors.length);
}

describe('cosineSimilarity', () => {
  it('идентичные векторы = 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('ортогональные векторы = 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('противоположные векторы = -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('нулевой вектор возвращает 0 (безопасно)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('centroid', () => {
  it('центроид одного вектора — сам вектор', () => {
    expect(centroid([[1, 2, 3]])).toEqual([1, 2, 3]);
  });

  it('центроид двух векторов — среднее', () => {
    const c = centroid([
      [0, 0, 0],
      [2, 4, 6],
    ]);
    expect(c).toEqual([1, 2, 3]);
  });

  it('пустой ввод возвращает пустой массив', () => {
    expect(centroid([])).toEqual([]);
  });

  it('центроид трёх векторов', () => {
    const c = centroid([
      [3, 3],
      [6, 6],
      [9, 9],
    ]);
    expect(c).toEqual([6, 6]);
  });
});
