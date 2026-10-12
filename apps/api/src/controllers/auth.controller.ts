import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { HttpError } from '../middleware/error.js';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema.js';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '../middleware/session.js';

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput);
  setRefreshCookie(res, result.refreshToken);
  res.set('Cache-Control', 'no-store').status(201).json({ user: result.user, accessToken: result.accessToken });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  setRefreshCookie(res, result.refreshToken);
  res.set('Cache-Control', 'no-store').json({ user: result.user, accessToken: result.accessToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof refreshToken !== 'string') throw new HttpError(401, 'Missing refresh cookie');
  const result = await authService.refresh(refreshToken);
  setRefreshCookie(res, result.refreshToken);
  res.set('Cache-Control', 'no-store').json({ user: result.user, accessToken: result.accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof refreshToken === 'string') await authService.logout(refreshToken);
  clearRefreshCookie(res);
  res.set('Cache-Control', 'no-store').status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const user = await authService.getMe(req.user.sub);
  res.json(user);
}
