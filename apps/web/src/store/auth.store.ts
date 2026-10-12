import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name?: string | null;
}

export interface Session {
  user: User;
  accessToken: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  initialized: boolean;
  revision: number;
  setSession: (data: Session) => void;
  clear: () => void;
}

// Remove credentials persisted by the previous client version.
try { localStorage.removeItem('hia-auth'); } catch { /* Storage may be unavailable. */ }

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  revision: 0,
  setSession: ({ user, accessToken }) => set((state) => ({
    user, accessToken, initialized: true,
    revision: state.revision + (state.user?.id !== user.id ? 1 : 0),
  })),
  clear: () => set((state) => ({
    user: null, accessToken: null, initialized: true, revision: state.revision + 1,
  })),
}));
