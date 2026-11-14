import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, AuthResponse, AuthUser, initApi, setToken, setUnauthorizedHandler } from '../services/api';
import * as crypto from '../lib/crypto';
import * as repo from '../db/repo';

interface AuthCtx {
  ready: boolean;
  user: AuthUser | null;
  needsPin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, pin: string) => Promise<void>;
  completePin: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsPin, setNeedsPin] = useState(false);

  const establish = useCallback(async (res: AuthResponse) => {
    setToken(res.token);
    await crypto.saveSession(res.token, JSON.stringify(res.user));
    await repo.upsertUser({ id: res.user.id, name: res.user.name, account_reference: res.user.account_reference, public_key: res.user.public_key });
    await repo.cacheBalance(res.user.id, res.wallet.balance);
    await repo.recoverInterrupted(res.user.id);
    setNeedsPin(!(await crypto.hasPin(res.user.id)));
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    await crypto.clearSession(); // keys + PIN + local queue stay on the device (offline-first)
    setUser(null);
    setNeedsPin(false);
  }, []);

  // boot: restore the session WITHOUT needing the network (offline-first)
  useEffect(() => {
    (async () => {
      try {
        await initApi();
        const s = await crypto.loadSession();
        if (s) {
          const u = JSON.parse(s.user) as AuthUser;
          setToken(s.token);
          await repo.recoverInterrupted(u.id);
          setNeedsPin(!(await crypto.hasPin(u.id)));
          setUser(u);
        }
      } finally {
        setReady(true);
      }
    })();
    setUnauthorizedHandler(() => {
      logout();
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      let res = await api.login({ email: email.trim(), password });
      // make sure this device has a key and the server knows its public key
      let kp = await crypto.loadKeyPair(res.user.id);
      if (!kp) {
        kp = crypto.generateKeyPair();
        await crypto.saveKeyPair(res.user.id, kp);
      }
      if (res.user.public_key !== kp.publicKey) res = await api.login({ email: email.trim(), password, public_key: kp.publicKey });
      await establish(res);
    },
    [establish]
  );

  const register = useCallback(
    async (name: string, email: string, password: string, pin: string) => {
      const kp = crypto.generateKeyPair();
      const res = await api.register({ name: name.trim(), email: email.trim(), password, public_key: kp.publicKey });
      await crypto.saveKeyPair(res.user.id, kp);
      await crypto.setPin(res.user.id, pin);
      await establish(res);
    },
    [establish]
  );

  const completePin = useCallback(
    async (pin: string) => {
      if (!user) return;
      await crypto.setPin(user.id, pin);
      setNeedsPin(false);
    },
    [user]
  );

  const value = useMemo(() => ({ ready, user, needsPin, login, register, completePin, logout }), [ready, user, needsPin, login, register, completePin, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
