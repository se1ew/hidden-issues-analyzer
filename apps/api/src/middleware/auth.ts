import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from './error.js';

export interface AuthPayload {
  sub: string; // user id
  email: string;
  exp?: number;
}

export function requestUserId(req: Request): string {
  if (!req.user?.sub) throw new HttpError(401, 'Unauthorized');
  return req.user.sub;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthPayload;
  }
}

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(payload: AuthPayload): string {
  return jwt.sign({ sub: payload.sub, email: payload.email }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'], jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AuthPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub
    || typeof payload.email !== 'string') throw new HttpError(401, 'Invalid access token');
  return { sub: payload.sub, email: payload.email, exp: payload.exp };
}

export function verifyRefreshToken(token: string): AuthPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub
    || typeof payload.email !== 'string' || typeof payload.exp !== 'number') {
    throw new HttpError(401, 'Invalid refresh token');
  }
  return { sub: payload.sub, email: payload.email, exp: payload.exp };
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Missing access token'));
    return;
  }
  try {
    req.user = verifyAccessToken(header.slice('Bearer '.length));
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired access token'));
  }
};
