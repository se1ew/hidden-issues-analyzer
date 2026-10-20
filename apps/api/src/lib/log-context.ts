import { AsyncLocalStorage } from 'node:async_hooks';
export const logContext = new AsyncLocalStorage<{ requestId?: string; runId?: string; importId?: string; reportId?: string }>();
