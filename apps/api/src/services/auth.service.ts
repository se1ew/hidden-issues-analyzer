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
      expiresAt: new Date(verifyRefreshToken(refreshToken).exp! * 1000),
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
  if (!stored || stored.userId !== payload.sub || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw new HttpError(401, 'Refresh token revoked or expired');
  }

  // Ротация: помечаем старый, выдаём новый
  const accessToken = signAccessToken({ sub: payload.sub, email: payload.email });
  const newRefreshToken = signRefreshToken(payload);
  const newHash = hashRefresh(newRefreshToken);

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), replacedBy: newHash },
    });
    if (consumed.count !== 1) throw new HttpError(401, 'Refresh token revoked or expired');
    await tx.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: newHash,
        expiresAt: new Date(verifyRefreshToken(newRefreshToken).exp! * 1000),
      },
    });
  });

  const user = await getMe(payload.sub);
  return { user, accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  // Follow rotation successors so logout also wins a race with another tab's refresh.
  await prisma.$transaction(async (tx) => {
    let tokenHash: string | null = hashRefresh(refreshToken);
    while (tokenHash) {
      await tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const stored: { replacedBy: string | null } | null = await tx.refreshToken.findUnique({
        where: { tokenHash }, select: { replacedBy: true },
      });
      tokenHash = stored?.replacedBy ?? null;
    }
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
