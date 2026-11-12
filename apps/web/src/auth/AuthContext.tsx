import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, hasSession, listenPlatform, onSessionChange } from './session.js';
import type { Permission } from '../../../api/src/core/access.js';

export interface Me {
  id: number;
  username: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  roleTitle: string | null;
  res: { id: number; name: string } | null;
  isSuper: boolean;
  status: 'active' | 'pending' | 'blocked';
  permissions: Permission[];
  allRes: boolean;
}

type State =
  | { phase: 'loading' }
  | { phase: 'anonymous' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; me: Me };

interface Auth {
  state: State;
  reload: () => void;
  can: (permission: Permission) => boolean;
}

const AuthCtx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(hasSession() ? { phase: 'loading' } : { phase: 'anonymous' });

  const reload = useCallback(() => {
    if (!hasSession()) { setState({ phase: 'anonymous' }); return; }
    api<Me>('/api/me')
      .then(me => setState({ phase: 'ready', me }))
      .catch((error: unknown) => {
        if (!hasSession()) setState({ phase: 'anonymous' });
        else setState({ phase: 'error', message: error instanceof ApiError ? error.message : 'Не удалось загрузить профиль.' });
      });
  }, []);

  useEffect(() => {
    let had = hasSession();
    reload();
    const stopPlatform = listenPlatform();
    const stopSession = onSessionChange(() => {
      const now = hasSession();
      // Перечитываем профиль только при входе/выходе, а не при каждом продлении токена.
      if (now !== had) { had = now; reload(); }
    });
    return () => { stopPlatform(); stopSession(); };
  }, [reload]);

  const can = useCallback((permission: Permission) => state.phase === 'ready' && state.me.permissions.includes(permission), [state]);

  return <AuthCtx.Provider value={{ state, reload, can }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}

export function useMe(): Me {
  const { state } = useAuth();
  if (state.phase !== 'ready') throw new Error('Профиль не загружен');
  return state.me;
}
