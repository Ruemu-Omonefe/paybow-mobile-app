import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SYNC_INTERVAL_MS } from '../config';
import { api, setForceOffline as applyForceOffline } from '../services/api';
import { syncNow, SyncReport } from '../services/syncManager';
import * as repo from '../db/repo';
import { useAuth } from './AuthContext';

interface SyncCtx {
  online: boolean; // backend reachable right now
  offlineMode: boolean; // user-forced "airplane mode" for demos / tests
  syncing: boolean;
  pendingCount: number;
  pendingOutgoing: number; // kobo reserved by not-yet-confirmed outgoing payments
  balance: number | null; // last balance confirmed by the backend (display cache)
  balanceUpdatedAt: number | null;
  lastSync: number | null;
  version: number; // bumps whenever local data changed – screens reload on it
  syncNow: (manual?: boolean) => Promise<SyncReport | null>;
  refreshLocal: () => Promise<void>;
  setOfflineMode: (v: boolean) => void;
}

const Ctx = createContext<SyncCtx>(null as unknown as SyncCtx);
export const useSync = () => useContext(Ctx);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [online, setOnline] = useState(false);
  const [offlineMode, setOfflineModeState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingOutgoing, setPendingOutgoing] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const busy = useRef(false);

  const refreshLocal = useCallback(async () => {
    if (!user) return;
    const [p, b] = await Promise.all([repo.pendingStats(user.id), repo.getCachedBalance(user.id)]);
    setPendingCount(p.count);
    setPendingOutgoing(p.outgoing);
    setBalance(b ? b.balance : null);
    setBalanceUpdatedAt(b ? b.updatedAt : null);
    setVersion((v) => v + 1);
  }, [user]);

  const runSync = useCallback(
    async (manual = false): Promise<SyncReport | null> => {
      if (!user || busy.current) return null;
      busy.current = true;
      try {
        try {
          await api.health();
          setOnline(true);
        } catch {
          setOnline(false);
          return null; // offline: everything stays PENDING in SQLite
        }
        setSyncing(true);
        const report = await syncNow(user.id, { ignoreBackoff: manual });
        setLastSync(Date.now());
        return report;
      } finally {
        busy.current = false;
        setSyncing(false);
        await refreshLocal();
      }
    },
    [user, refreshLocal]
  );

  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;

  const setOfflineMode = useCallback((v: boolean) => {
    applyForceOffline(v);
    setOfflineModeState(v);
    if (v) setOnline(false);
    else runSyncRef.current(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshLocal();
    runSyncRef.current();
    const unsubNet = NetInfo.addEventListener((s) => {
      if (s.isConnected) runSyncRef.current(); // connectivity restored -> synchronize pending queue
      else setOnline(false);
    });
    const timer = setInterval(() => runSyncRef.current(), SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') runSyncRef.current();
    });
    return () => {
      unsubNet();
      clearInterval(timer);
      sub.remove();
    };
  }, [user, refreshLocal]);

  const value = useMemo<SyncCtx>(
    () => ({ online, offlineMode, syncing, pendingCount, pendingOutgoing, balance, balanceUpdatedAt, lastSync, version, syncNow: runSync, refreshLocal, setOfflineMode }),
    [online, offlineMode, syncing, pendingCount, pendingOutgoing, balance, balanceUpdatedAt, lastSync, version, runSync, refreshLocal, setOfflineMode]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
