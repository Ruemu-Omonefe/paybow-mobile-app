import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, AuthUser, initApi, LoginResponse, setToken, setUnauthorizedHandler } from '../services/api';
import { SERVER_PUBLIC_KEY } from '../config';
import { verifyCertificate } from '../lib/protocol';
import * as crypto from '../lib/crypto';
import * as repo from '../db/repo';

interface AuthCtx {
  ready: boolean;
  user: AuthUser | null;
  needsPin: boolean;
  pinMode: 'verify' | 'migrate' | 'unavailable' | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, pin: string) => Promise<void>;
  completePin: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

type PinMode = AuthCtx['pinMode'];

function getPinMode(hasAccountPin: boolean | undefined, hasLocalPin: boolean): PinMode {
  if (hasAccountPin === false) return hasLocalPin ? 'migrate' : 'unavailable';
  return hasLocalPin ? null : 'verify';
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsPin, setNeedsPin] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>(null);

  const establish = useCallback(async (res: LoginResponse) => {
    if (!res.certificate || !verifyCertificate(res.certificate, SERVER_PUBLIC_KEY))
      throw new Error('The server returned an invalid certificate. Check SERVER_PUBLIC_KEY in the app config.');
    setToken(res.token);
    await crypto.saveSession(res.token, JSON.stringify(res.user));
    await repo.upsertUser({ id: res.user.id, name: res.user.name, wallet_id: res.user.wallet_id, email: res.user.email, public_key: res.certificate.pk });
    await repo.saveCertificate(res.user.id, res.certificate);
    await repo.ensureWallet(res.user.id, res.user.wallet_id); // local wallet: starts at ₦0, independent of the mirror
    await repo.recoverInterrupted(res.user.id);
    const mode = getPinMode(res.user.has_payment_pin, await crypto.hasPin(res.user.id));
    setPinMode(mode);
    setNeedsPin(mode !== null);
    setUser(res.user);
  }, []);

  const clearLocalSession = useCallback(async () => {
    setToken(null);
    await crypto.clearSession(); // keys + PIN + local queue stay on the device (offline-first)
    setUser(null);
    setNeedsPin(false);
    setPinMode(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    await clearLocalSession();
  }, [clearLocalSession]);

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
          const mode = getPinMode(u.has_payment_pin, await crypto.hasPin(u.id));
          setPinMode(mode);
          setNeedsPin(mode !== null);
          setUser(u);
        }
      } finally {
        setReady(true);
      }
    })();
    setUnauthorizedHandler(() => { void clearLocalSession(); });
    return () => { setUnauthorizedHandler(null); };
  }, [clearLocalSession]);

  /** Login: key pair is generated once on the device (private key → SecureStore), public key → backend, certificate back. */
  const loginWithKey = useCallback(
    async (email: string, password: string) => {
      const probe = await api.login({ email: email.trim(), password });
      let kp = await crypto.loadKeyPair(probe.user.id);
      if (!kp) {
        kp = crypto.generateKeyPair();
        await crypto.saveKeyPair(probe.user.id, kp);
      }
      const res = await api.login({ email: email.trim(), password, public_key: kp.publicKey });
      await establish(res);
    },
    [establish]
  );

  const login = useCallback((email: string, password: string) => loginWithKey(email, password), [loginWithKey]);

  const register = useCallback(
    async (name: string, email: string, password: string, pin: string) => {
      const created = await api.register({ name: name.trim(), email: email.trim(), password, payment_pin: pin });
      await crypto.setPin(created.user.id, pin);
      await loginWithKey(email, password);
    },
    [loginWithKey]
  );

  const completePin = useCallback(
    async (pin: string) => {
      if (!user) return;
      if (pinMode === 'verify') {
        const result = await api.verifyPaymentPin(pin);
        if (!result.valid) throw new Error('Incorrect payment PIN.');
        await crypto.setPin(user.id, pin);
      } else if (pinMode === 'migrate') {
        if (!(await crypto.verifyPin(user.id, pin))) throw new Error('That does not match the payment PIN on this device.');
        try {
          await api.setupPaymentPin(pin);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          const result = await api.verifyPaymentPin(pin);
          if (!result.valid) throw new Error('A different payment PIN is already linked to this account.');
        }
      } else {
        throw new Error('This account PIN must be linked from the device where it was first created.');
      }
      setNeedsPin(false);
      setPinMode(null);
    },
    [user, pinMode]
  );

  const value = useMemo(() => ({ ready, user, needsPin, pinMode, login, register, completePin, logout }), [ready, user, needsPin, pinMode, login, register, completePin, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
