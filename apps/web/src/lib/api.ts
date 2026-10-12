import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore, type Session } from '../store/auth.store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30_000,
  headers: { 'X-ReviewLens-CSRF': '1' },
});

type SessionRequest = InternalAxiosRequestConfig & { _retry?: boolean; _sessionRevision?: number };

api.interceptors.request.use((config: SessionRequest) => {
  const state = useAuthStore.getState();
  const token = state.accessToken;
  config._sessionRevision = state.revision;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;
let loggingOut = false;

async function refreshAccessToken(): Promise<string> {
  const { revision, clear, setSession } = useAuthStore.getState();
  try {
    const { data } = await axios.post<Session>(
      `${API_URL}/api/auth/refresh`,
      {},
      { withCredentials: true, timeout: 30_000, headers: { 'X-ReviewLens-CSRF': '1' } },
    );
    if (useAuthStore.getState().revision !== revision) throw new Error('Session changed');
    setSession(data);
    return data.accessToken;
  } catch (err) {
    if (useAuthStore.getState().revision === revision) clear();
    throw err;
  }
}

function refreshSession(): Promise<string> {
  if (loggingOut) return Promise.reject(new Error('Logout in progress'));
  if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function restoreSession(): Promise<void> {
  try { await refreshSession(); } catch { /* Anonymous session or unavailable API. */ }
}

export async function logoutSession(): Promise<void> {
  loggingOut = true;
  try {
    // Finish rotation before logout so the server revokes the newest cookie.
    if (refreshPromise) await refreshPromise.catch(() => undefined);
    await api.post('/api/auth/logout');
    useAuthStore.getState().clear();
  } finally {
    loggingOut = false;
  }
}

api.interceptors.response.use(
  (res) => {
    const config = res.config as SessionRequest;
    if (!config.url?.includes('/auth/') && config._sessionRevision !== useAuthStore.getState().revision) {
      return Promise.reject(new Error('Session changed'));
    }
    return res;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | SessionRequest
      | undefined;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      useAuthStore.getState().user &&
      originalRequest._sessionRevision === useAuthStore.getState().revision &&
      !originalRequest.url?.includes('/auth/')
    ) {
      originalRequest._retry = true;
      try {
        const current = useAuthStore.getState().accessToken;
        const newToken = originalRequest.headers.Authorization !== `Bearer ${current}` && current
          ? current : await refreshSession();
        if (originalRequest._sessionRevision !== useAuthStore.getState().revision) throw error;
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return api.request(originalRequest);
      } catch {
        // refreshSession clears the shared promise after completion.
      }
    }
    return Promise.reject(error);
  },
);
