import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, logoutSession, restoreSession } from './api';
import { useAuthStore } from '../store/auth.store';

const session = { user: { id: 'a', email: 'a@test.invalid' }, accessToken: 'access-new' };
function response(config: InternalAxiosRequestConfig, data: unknown = {}): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
}

beforeEach(() => {
  useAuthStore.getState().clear();
  api.defaults.adapter = async (config) => response(config);
});

describe('in-memory cookie session client', () => {
  it('restores the user with a credentialed refresh request without a body token', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: session });
    await restoreSession();
    expect(post).toHaveBeenCalledWith(expect.stringContaining('/api/auth/refresh'), {},
      expect.objectContaining({ withCredentials: true, headers: { 'X-ReviewLens-CSRF': '1' } }));
    expect(useAuthStore.getState().user).toEqual(session.user);
    expect(useAuthStore.getState().accessToken).toBe(session.accessToken);
    expect(localStorage.getItem('hia-auth')).toBeNull();
  });

  it('finishes anonymous initialization when the cookie has expired', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('expired cookie'));
    await restoreSession();
    expect(useAuthStore.getState()).toMatchObject({ user: null, accessToken: null, initialized: true });
  });

  it('does not restore an old user after the session has changed', async () => {
    let resolve!: (value: { data: typeof session }) => void;
    vi.spyOn(axios, 'post').mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = restoreSession();
    useAuthStore.getState().setSession({ user: { id: 'b', email: 'b@test.invalid' }, accessToken: 'b-token' });
    resolve({ data: session });
    await pending;
    expect(useAuthStore.getState().user?.id).toBe('b');
    expect(useAuthStore.getState().accessToken).toBe('b-token');
  });

  it('shares one refresh for simultaneous expired-token requests', async () => {
    useAuthStore.getState().setSession({ ...session, accessToken: 'expired' });
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: session });
    api.defaults.adapter = async (config) => {
      if (config.headers.Authorization === 'Bearer expired') {
        throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
          { ...response(config), status: 401 });
      }
      return response(config, { authorized: config.headers.Authorization });
    };
    const results = await Promise.all([api.get('/api/products'), api.get('/api/reviews')]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.data.authorized)).toEqual(['Bearer access-new', 'Bearer access-new']);
  });

  it('rejects a response from the previous account', async () => {
    useAuthStore.getState().setSession(session);
    api.defaults.adapter = async (config) => {
      useAuthStore.getState().setSession({ user: { id: 'b', email: 'b@test.invalid' }, accessToken: 'b-token' });
      return response(config, { secret: 'a data' });
    };
    await expect(api.get('/api/reviews')).rejects.toThrow('Session changed');
  });

  it('clears local credentials only after successful server logout', async () => {
    useAuthStore.getState().setSession(session);
    api.defaults.adapter = async (config) => {
      expect(config.url).toBe('/api/auth/logout');
      expect(config.headers['X-ReviewLens-CSRF']).toBe('1');
      expect(useAuthStore.getState().user?.id).toBe('a');
      return response(config);
    };
    await logoutSession();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('preserves the session so logout can be retried when the server is unavailable', async () => {
    useAuthStore.getState().setSession(session);
    api.defaults.adapter = async () => { throw new Error('offline'); };
    await expect(logoutSession()).rejects.toThrow('offline');
    expect(useAuthStore.getState().user?.id).toBe('a');
  });
});
