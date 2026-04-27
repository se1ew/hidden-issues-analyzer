import { prisma } from '../lib/prisma.js';
import { chatCompletion } from '../lib/openrouter.js';

export async function generateProductSummary(productId?: string): Promise<string> {
  const where = productId
    ? productId === '__unassigned__'
      ? { productId: null }
      : { productId }
    : {};

  const [issues, reviewCount, stats] = await Promise.all([
    prisma.hiddenIssue.findMany({
      where,
      orderBy: { hiddenScore: 'desc' },
      take: 10,
      select: { title: true, description: true, hiddenScore: true, size: true, resolved: true },
    }),
    prisma.review.count({ where: productId ? (productId === '__unassigned__' ? { productId: null } : { productId }) : {} }),
    prisma.review.groupBy({
      by: ['sentiment'],
      where: productId ? (productId === '__unassigned__' ? { productId: null } : { productId }) : {},
      _count: { id: true },
    }),
  ]);

  const sentimentMap = Object.fromEntries(stats.map((s) => [s.sentiment ?? 'unknown', s._count.id]));
  const neg = sentimentMap['negative'] ?? 0;
  const pos = sentimentMap['positive'] ?? 0;
  const neu = sentimentMap['neutral'] ?? 0;

  const issueLines = issues
    .map((i, idx) => `${idx + 1}. "${i.title}" — score ${(i.hiddenScore * 100).toFixed(0)}%, ${i.size} отзывов${i.resolved ? ' [РЕШЕНО]' : ''}`)
    .join('\n');

  const prompt = `Ты — аналитик отзывов покупателей. На основе данных сделай краткий executive summary на русском языке.

ДАННЫЕ:
- Всего отзывов: ${reviewCount}
- Позитивных: ${pos}, Нейтральных: ${neu}, Негативных: ${neg}
- Топ скрытых проблем (невидимых, но системных):
${issueLines || 'Нет данных'}

ЗАДАЧА: Напиши 3-5 предложений — ключевые выводы, самые острые проблемы и рекомендации.
Пиши кратко, по делу, как аналитик для менеджера продукта. Без вводных слов и воды.`;

  const text = await chatCompletion({ messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 512 });
  return text.trim();
}
