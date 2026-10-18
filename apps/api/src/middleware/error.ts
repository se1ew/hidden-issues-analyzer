import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { LlmError } from '../lib/llm.js';
import { logger } from '../lib/logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (_req: Request, res: Response, _next: NextFunction): void => {
  res.status(404).json(errorBody('not_found', 'Not Found'));
};

export function errorBody(code: string, message: string, details?: unknown) {
  return { code, message, error: message, ...(details === undefined ? {} : { details }) };
}
const statusCodes: Record<number, string> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden',
  404: 'not_found', 409: 'conflict', 413: 'payload_too_large', 422: 'validation_failed', 429: 'rate_limited', 503: 'unavailable' };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof LlmError) {
    res.status(err.code === 'cancelled' ? 409 : err.code === 'input_too_long' ? 422 : 503)
      .json(errorBody(err.code, err.message));
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json(errorBody(err.code === 'LIMIT_FILE_SIZE' ? 'payload_too_large' : 'invalid_upload',
      err.code === 'LIMIT_FILE_SIZE' ? 'CSV превышает 25 МиБ' : 'Некорректная загрузка файла'));
    return;
  }
  if (err instanceof ZodError) {
    // Only validation messages/paths; never include request values or raw errors.
    res.status(422).json({ ...errorBody('validation_failed', 'Validation failed', err.flatten()), issues: err.flatten() });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code ?? statusCodes[err.status] ?? 'request_failed', err.message, err.details));
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 413) {
    res.status(status).json(errorBody(statusCodes[status], status === 400 ? 'Некорректный JSON' : 'Слишком большой запрос'));
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json(errorBody('internal_error', 'Internal Server Error'));
};
