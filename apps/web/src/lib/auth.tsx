import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthResponse, User } from '@focusguard/contracts';
import { api, refreshSession, tokens } from './api';
import { queryClient } from './query-client';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    timezone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  const accept = useCallback((res: AuthResponse) => {
    tokens.set(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  // Restore the session from the refresh cookie on load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((res) => {
      if (cancelled) return;
      if (res) accept(res);
      else setStatus('anonymous');
    });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  // If a refresh fails mid-session (token reuse, revocation), drop to logged-out.
  useEffect(
    () =>
      tokens.subscribe((t) => {
        if (t === null) {
          setUser(null);
          setStatus('anonymous');
        }
      }),
    [],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      accept(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }));
    },
    [accept],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (input) => {
      accept(await api<AuthResponse>('/auth/register', { method: 'POST', body: input }));
    },
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', csrf: true });
    } finally {
      tokens.set(null);
      queryClient.clear();
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout, setUser }),
    [status, user, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
