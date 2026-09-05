import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, getToken, setToken } from './api';
import { disconnectSocket } from './socket';
import type { Role, User } from './types';

const USER_KEY = 'swiftride.user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: Role;
  vehicle?: { vehicle_type: string; make?: string; model?: string; color?: string; plate?: string };
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  offline: boolean;
  login: (email: string, password: string, role?: Role) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start from the cached user so the app opens logged in instantly, even before
  // (or without) reaching the server.
  const [user, setUserState] = useState<User | null>(() => (getToken() ? readCachedUser() : null));
  const [loading, setLoading] = useState(Boolean(getToken()) && !readCachedUser());
  const [offline, setOffline] = useState(false);

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    cacheUser(u);
  }, []);

  /**
   * Re-validate the session. Only a definite 401 logs the user out; a network
   * failure keeps the cached session so a flaky connection never signs you out.
   */
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user, token } = await api<{ user: User; token?: string }>('/auth/me');
      if (token) setToken(token);
      setUser(user);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setUser(null);
      } else {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    void refresh();
    // Re-validate whenever the app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string, role?: Role) => {
      const { token, user } = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password, role } });
      setToken(token);
      setUser(user);
      setOffline(false);
      return user;
    },
    [setUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const { token, user } = await api<{ token: string; user: User }>('/auth/register', { method: 'POST', body: input });
      setToken(token);
      setUser(user);
      return user;
    },
    [setUser],
  );

  const logout = useCallback(() => {
    setToken(null);
    disconnectSocket();
    setUser(null);
  }, [setUser]);

  const value = useMemo(
    () => ({ user, loading, offline, login, register, logout, refresh, setUser: setUser as (u: User) => void }),
    [user, loading, offline, login, register, logout, refresh, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
