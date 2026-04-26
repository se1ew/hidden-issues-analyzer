import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type AuthPayload,
} from '../middleware/auth.js';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema.js';

const REFRESH_TTL_DAYS = 7;

function hashRefresh(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokens(payload: AuthPayload): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await prisma.refreshToken.create({
    data: {
      userId: payload.sub,
      tokenHash: hashRefresh(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, 'Email уже зарегистрирован');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name ?? null },
  });

  const tokens = await issueTokens({ sub: user.id, email: user.email });
  return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new HttpError(401, 'Неверный email или пароль');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Неверный email или пароль');

  const tokens = await issueTokens({ sub: user.id, email: user.email });
  return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
}

export async function refresh(refreshToken: string) {
  let payload: AuthPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new HttpError(401, 'Invalid refresh token');
  }

  const tokenHash = hashRefresh(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new HttpError(401, 'Refresh token revoked or expired');
  }

  // Ротация: помечаем старый, выдаём новый
  const accessToken = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);
  const newHash = hashRefresh(newRefreshToken);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: newHash },
    }),
    prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    }),
  ]);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefresh(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}
