import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRouter } from '../routes/auth.routes.js';
import { errorHandler, HttpError } from './error.js';
import { signRefreshToken, verifyRefreshToken } from './auth.js';
import * as authService from '../services/auth.service.js';

vi.mock('../services/auth.service.js', () => ({
  register: vi.fn(), login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), getMe: vi.fn(),
}));

const app = express();
app.use(express.json(), cookieParser());
app.use('/api/auth', authRouter);
app.use(errorHandler);
const user = { id: 'session-user', email: 'session@example.com', name: null };
const credentials = { email: user.email, password: 'password123' };

beforeEach(() => vi.clearAllMocks());

describe('cookie session HTTP contract', () => {
  it('returns only access token and user, with a scoped HttpOnly cookie', async () => {
    const refreshToken = signRefreshToken({ sub: user.id, email: user.email });
    vi.mocked(authService.register).mockResolvedValue({ user, accessToken: 'access', refreshToken });
    const result = await request(app).post('/api/auth/register').set('X-ReviewLens-CSRF', '1')
      .set('Origin', 'http://localhost:5173').send(credentials).expect(201);
    expect(result.body).toEqual({ user, accessToken: 'access' });
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('Path=/api/auth');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(result.headers['set-cookie'][0]).not.toContain('Secure');
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it.each(['/login', '/register', '/refresh', '/logout'])('rejects unsafe session mutation %s', async (endpoint) => {
    await request(app).post(`/api/auth${endpoint}`).send(credentials).expect(403);
    await request(app).post(`/api/auth${endpoint}`).set('X-ReviewLens-CSRF', '1')
      .set('Origin', 'https://foreign.example').send(credentials).expect(403);
    await request(app).post(`/api/auth${endpoint}`).set('X-ReviewLens-CSRF', '1')
      .set('Sec-Fetch-Site', 'cross-site').send(credentials).expect(403);
    expect(authService.login).not.toHaveBeenCalled();
    expect(authService.refresh).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not accept refresh tokens from the body', async () => {
    await request(app).post('/api/auth/refresh').set('X-ReviewLens-CSRF', '1')
      .send({ refreshToken: 'old-body-token' }).expect(401);
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it('reads the cookie for refresh and expires the same cookie on logout', async () => {
    const token = signRefreshToken({ sub: user.id, email: user.email });
    vi.mocked(authService.refresh).mockResolvedValue({ user: { ...user, createdAt: new Date() }, accessToken: 'new', refreshToken: token });
    const result = await request(app).post('/api/auth/refresh').set('X-ReviewLens-CSRF', '1')
      .set('Cookie', `hia-refresh=${token}`).expect(200);
    expect(authService.refresh).toHaveBeenCalledWith(token);
    expect(result.body).not.toHaveProperty('refreshToken');
    const logout = await request(app).post('/api/auth/logout').set('X-ReviewLens-CSRF', '1')
      .set('Cookie', `hia-refresh=${token}`).expect(204);
    expect(authService.logout).toHaveBeenCalledWith(token);
    expect(logout.headers['set-cookie'][0]).toContain('hia-refresh=; Path=/api/auth');
    expect(logout.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('allows idempotent logout with no cookie', async () => {
    await request(app).post('/api/auth/logout').set('X-ReviewLens-CSRF', '1').expect(204);
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('uses unique tokens even when issued during the same second', () => {
    const first = signRefreshToken({ sub: user.id, email: user.email });
    const second = signRefreshToken({ sub: user.id, email: user.email });
    expect(first).not.toBe(second);
    expect(verifyRefreshToken(first).sub).toBe(user.id);
  });

  it('rejects bcrypt-truncated unicode passwords before calling the service', async () => {
    await request(app).post('/api/auth/register').set('X-ReviewLens-CSRF', '1')
      .send({ ...credentials, password: 'я'.repeat(37) }).expect(422);
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('limits repeated login attempts with a retry header', async () => {
    vi.mocked(authService.login).mockRejectedValue(new HttpError(401, 'Неверный email или пароль'));
    let limited = false;
    for (let attempt = 0; attempt < 21; attempt++) {
      const result = await request(app).post('/api/auth/login').set('X-ReviewLens-CSRF', '1').send(credentials);
      if (result.status === 429) {
        expect(result.headers['retry-after']).toBeDefined();
        expect(result.body.error).toContain('Слишком много попыток');
        limited = true;
        break;
      }
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ code: 'unauthorized', message: 'Неверный email или пароль', error: 'Неверный email или пароль' });
    }
    expect(limited).toBe(true);
  });
});
