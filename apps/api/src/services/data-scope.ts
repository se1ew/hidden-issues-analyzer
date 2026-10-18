import type { Prisma } from '@prisma/client';
import { HttpError } from '../middleware/error.js';
import type { DataScope } from '../schemas/data-scope.schema.js';

/** Group metrics describe an immutable run, so never silently slice its denominator. */
export function assertRunPeriod(scope: Prisma.JsonValue, query: Pick<DataScope, 'from' | 'to'>) {
  if (!query.from && !query.to) return;
  const period = (scope as { period?: { from?: string; to?: string } } | null)?.period;
  if (!period?.from || !period.to || Date.parse(period.from) !== Date.parse(query.from!) || Date.parse(period.to) !== Date.parse(query.to!)) {
    throw new HttpError(409, 'Период не совпадает с областью запуска. Выберите подходящий запуск или создайте анализ этого периода.', undefined, 'scope_mismatch');
  }
}
