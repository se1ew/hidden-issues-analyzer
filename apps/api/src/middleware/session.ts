import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { verifyRefreshToken } from './auth.js';
import { HttpError } from './error.js';

export const REFRESH_COOKIE = 'hia-refresh';
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: new URL(env.WEB_ORIGIN).protocol === 'https:',
  sameSite: 'lax',
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions, expires: new Date(verifyRefreshToken(token).exp! * 1000),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

// All session mutations require an explicit header, including non-browser clients.
// Browsers cannot add it across origins without an approved CORS preflight.
export function requireSessionOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (req.get('X-ReviewLens-CSRF') !== '1'
    || (req.get('Origin') && req.get('Origin') !== env.WEB_ORIGIN)
    || req.get('Sec-Fetch-Site') === 'cross-site') {
    next(new HttpError(403, 'Session request origin rejected'));
    return;
  }
  next();
}
