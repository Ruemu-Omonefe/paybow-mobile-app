import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Banner, TxRow, Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { formatDuration, formatNaira, timeAgo } from '../lib/money';
import { caption, colors, h2, space } from '../theme';

const logo = require('../../assets/logo.png');

export function HomeScreen() {
  const { user } = useAuth();
  const nav = useNavigation<any>();
  const s = useSync();
  const [txs, setTxs] = useState<repo.LocalTx[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (user) setTxs(await repo.listTransactions(user.id, 5));
  }, [user]);
  useEffect(() => {
    load();
  }, [load, s.version]);

  const onRefresh = async () => {
    setRefreshing(true);
    await s.syncNow(true);
    await load();
    setRefreshing(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={caption}>Hello,</Text>
            <Text style={[h2, { fontSize: 22 }]}>{user?.name}</Text>
          </View>
          <Image source={logo} style={{ width: 64, height: 64 }} resizeMode="contain" />
        </View>

        <View style={{ backgroundColor: colors.primary, borderRadius: 20, padding: space.xl }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Wallet balance (on this device)</Text>
          <Text style={{ color: colors.background, fontSize: 36, fontWeight: '800', marginTop: 4 }}>{s.balance == null ? '—' : formatNaira(s.balance)}</Text>
          <Text style={{ color: colors.accent, fontSize: 12, marginTop: 2 }}>
            Wallet {user?.wallet_id}{s.mirrorBalance != null ? ` · Server mirror ${formatNaira(s.mirrorBalance)}` : ''}
          </Text>
          <Text style={{ color: colors.accent, fontSize: 12, marginTop: 2 }}>Daily offline allowance left: {formatNaira(s.dailyRemaining)}</Text>
          {s.pendingCount > 0 && (
            <View style={{ marginTop: 14, backgroundColor: 'rgba(185,143,96,0.25)', borderRadius: 12, padding: 10 }}>
              <Text style={{ color: colors.background, fontSize: 13 }}>
                {s.pendingCount} transaction(s) awaiting server confirmation{s.pendingOutgoing > 0 ? ` · ${formatNaira(s.pendingOutgoing)} sent` : ''}
              </Text>
            </View>
          )}
        </View>

        {s.deadline && s.deadline.deadline !== null && s.deadline.outstanding > 0 && (
          s.deadline.restricted ? (
            <Banner icon="lock-closed-outline" tone="danger" text="Sync deadline passed: offline payments are paused. Connect to the internet to synchronize and unlock." />
          ) : (
            <Banner icon="alarm-outline" tone={s.deadline.stage > 0 ? 'primary' : 'accent'} text={`Sync within ${formatDuration(s.deadline.deadline - Date.now())} to keep paying offline`} />
          )
        )}

        {s.offlineMode ? (
          <Banner icon="cloud-offline-outline" tone="primary" text={`Offline mode ON · ${s.pendingCount} transaction(s) queued on this device`} />
        ) : s.online ? (
          s.syncing ? (
            <Banner icon="sync-outline" text="Synchronizing with Paybow…" />
          ) : s.pendingCount > 0 ? (
            <Banner icon="time-outline" text={`${s.pendingCount} pending – will sync automatically`} />
          ) : (
            <Banner icon="checkmark-circle-outline" text={`Online · all synced (${timeAgo(s.lastSync)})`} />
          )
        ) : (
          <Banner icon="cloud-offline-outline" tone="primary" text={`No connection · ${s.pendingCount} queued locally, will sync when you're back online`} />
        )}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button title="Pay" icon="scan-outline" onPress={() => nav.navigate('Pay')} style={{ flex: 1 }} />
          <Button title="Receive" icon="qr-code-outline" kind="secondary" onPress={() => nav.navigate('Receive')} style={{ flex: 1 }} />
        </View>
        <Button title="Add money" icon="add-circle-outline" kind="outline" onPress={() => nav.navigate('Fund')} />

        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
            <Text style={h2}>Recent transactions</Text>
            <Text style={{ color: colors.secondary, fontWeight: '700' }} onPress={() => nav.navigate('History')}>See all</Text>
          </View>
          {txs.length === 0 ? (
            <Card style={{ alignItems: 'center', gap: 6 }}>
              <Ionicons name="receipt-outline" size={28} color={colors.accent} />
              <Text style={caption}>No transactions yet. Pay or receive to get started.</Text>
            </Card>
          ) : (
            txs.map((t) => <TxRow key={t.transaction_id} tx={t} onPress={() => nav.navigate('TxDetail', { id: t.transaction_id })} />)
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
