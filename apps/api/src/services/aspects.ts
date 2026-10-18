import type { AspectCategory } from '@prisma/client';

export const ASPECT_DICTIONARY_VERSION = 'ru-aspects-v1';
const entries: Array<[AspectCategory, string, string[]]> = [
  ['quality', 'качество', ['quality', 'качество товара', 'сборка', 'качество сборки', 'надёжность', 'надежность']],
  ['functionality', 'функциональность', ['functionality', 'работоспособность', 'работа', 'функции']],
  ['functionality', 'звук', ['звучание', 'качество звука', 'sound']],
  ['functionality', 'шум', ['шумность', 'уровень шума']],
  ['functionality', 'связь', ['подключение', 'соединение', 'bluetooth']],
  ['material', 'материал', ['material', 'материалы', 'пластик', 'ткань', 'состав']],
  ['size_fit', 'размер и посадка', ['size_fit', 'размер', 'посадка', 'размерность']],
  ['appearance', 'внешний вид', ['appearance', 'дизайн', 'цвет']],
  ['usability', 'удобство', ['usability', 'удобство использования', 'эргономика', 'комфорт']],
  ['price', 'цена', ['price', 'стоимость', 'цена и качество', 'соотношение цены и качества']],
  ['delivery', 'доставка', ['delivery', 'курьер', 'срок доставки']],
  ['seller', 'продавец', ['seller', 'обслуживание', 'работа продавца']],
  ['packaging', 'упаковка', ['packaging', 'коробка', 'состояние упаковки']],
];

export function canonicalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const dictionary = new Map(entries.flatMap(([category, name, aliases]) =>
  [name, ...aliases].map((alias) => [canonicalText(alias), { category, name }] as const)));

export function normalizeAspect(originalName: string) {
  const found = dictionary.get(canonicalText(originalName));
  return { category: found?.category ?? 'other' as AspectCategory,
    name: found?.name ?? originalName.trim(), originalName };
}
