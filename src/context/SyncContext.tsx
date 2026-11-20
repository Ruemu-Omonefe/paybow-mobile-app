import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SYNC_INTERVAL_MS } from '../config';
import { api, setForceOffline as applyForceOffline } from '../services/api';
import { syncNow, SyncOutcome } from '../services/syncManager';
import { Alert } from 'react-native';
import * as repo from '../db/repo';
import { useAuth } from './AuthContext';

interface SyncCtx {
  online: boolean; // backend reachable right now
  offlineMode: boolean; // user-forced "airplane mode" for demos / tests
  syncing: boolean;
  pendingCount: number;
  pendingOutgoing: number; // kobo reserved by not-yet-confirmed outgoing payments
  balance: number | null; // LOCAL wallet balance (spendable)
  mirrorBalance: number | null; // last backend mirror balance (display only)
  dailyRemaining: number;
  deadline: repo.DeadlineInfo | null;
  lastSync: number | null;
  version: number; // bumps whenever local data changed – screens reload on it
  syncNow: (manual?: boolean) => Promise<SyncOutcome | null>;
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
  const [mirrorBalance, setMirrorBalance] = useState<number | null>(null);
  const [dailyRemaining, setDailyRemaining] = useState(0);
  const [deadline, setDeadline] = useState<repo.DeadlineInfo | null>(null);
  const alerted = useRef(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const busy = useRef(false);

  const refreshLocal = useCallback(async () => {
    if (!user) return;
    await repo.expireOverdue(user.id);
    const [p, w, d] = await Promise.all([repo.pendingStats(user.id), repo.getWallet(user.id), repo.getDeadlineInfo(user.id)]);
    setPendingCount(p.count);
    setPendingOutgoing(p.outgoing);
    setBalance(w ? w.balance : 0);
    setDailyRemaining(w ? w.dailyRemaining : 0);
    setDeadline(d);
    if (d.stage > alerted.current && d.outstanding > 0 && !d.restricted) {
      alerted.current = d.stage;
      Alert.alert('Sync reminder', d.stage === 2 ? 'Your offline transactions must be synchronized soon, or offline payments will be paused. Connect to the internet.' : 'You have offline transactions waiting to sync. Please connect to the internet soon.');
    }
    if (d.outstanding === 0) alerted.current = 0;
    setVersion((v) => v + 1);
  }, [user]);

  const runSync = useCallback(
    async (manual = false): Promise<SyncOutcome | null> => {
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
        const report = await syncNow(user.id, manual);
        setLastSync(Date.now());
        if (report && report.balance !== null) setMirrorBalance(report.balance);
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
    const timer = setInterval(() => { refreshLocal(); runSyncRef.current(); }, SYNC_INTERVAL_MS);
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
    () => ({ online, offlineMode, syncing, pendingCount, pendingOutgoing, balance, mirrorBalance, dailyRemaining, deadline, lastSync, version, syncNow: runSync, refreshLocal, setOfflineMode }),
    [online, offlineMode, syncing, pendingCount, pendingOutgoing, balance, mirrorBalance, dailyRemaining, deadline, lastSync, version, runSync, refreshLocal, setOfflineMode]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
