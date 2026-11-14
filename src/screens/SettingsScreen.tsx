import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { Screen, Card, Button, Input, Row } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { getBaseUrl, getDeviceId, setBaseUrl } from '../services/api';
import { caption, colors, h1, h2, space } from '../theme';

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const sync = useSync();
  const [server, setServer] = useState(getBaseUrl());
  const [m, setM] = useState<repo.SyncMetrics | null>(null);

  const load = useCallback(async () => {
    if (user) setM(await repo.syncMetrics(user.id));
  }, [user]);
  useEffect(() => {
    load();
  }, [load, sync.version]);

  const confirmLogout = () => {
    const msg = sync.pendingCount > 0 ? `${sync.pendingCount} transaction(s) are still pending on this device. They stay queued and will sync after you log in again.` : 'You can log in again at any time.';
    Alert.alert('Log out?', msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: logout }]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={h1}>Settings</Text>

        <Card>
          <Row label="Name" value={user?.name ?? ''} />
          <Row label="Email" value={user?.email ?? ''} />
          <Row label="Account reference" value={user?.account_reference ?? ''} />
          <Row label="Device ID" value={getDeviceId()} mono />
        </Card>

        <Card style={{ gap: space.md }}>
          <Text style={h2}>Connectivity testing</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Simulate offline mode</Text>
              <Text style={caption}>Blocks all network calls so you can demo offline payments, then switch off to watch the queue sync.</Text>
            </View>
            <Switch value={sync.offlineMode} onValueChange={sync.setOfflineMode} trackColor={{ true: colors.secondary, false: colors.accent }} thumbColor={colors.background} />
          </View>
          <Row label="Backend reachable" value={sync.online ? 'Yes' : 'No'} />
          <Row label="Pending / syncing" value={String(sync.pendingCount)} />
          <Button title="Sync now" icon="sync-outline" kind="secondary" loading={sync.syncing} onPress={() => sync.syncNow(true)} />
        </Card>

        <Card style={{ gap: 4 }}>
          <Text style={h2}>Sync metrics (this device)</Text>
          <Row label="Sync runs" value={String(m?.attempts ?? 0)} />
          <Row label="Submitted / resolved" value={`${m?.submitted ?? 0} / ${m?.resolved ?? 0}`} />
          <Row label="Synchronization success rate" value={m?.successRate == null ? '—' : `${m.successRate}%`} />
          <Row label="Average sync latency" value={m?.avgLatencyMs == null ? '—' : `${m.avgLatencyMs} ms`} />
        </Card>

        <Card>
          <Input label="Server URL" value={server} onChangeText={setServer} keyboardType="url" />
          <Button title="Save server URL" kind="outline" onPress={async () => { await setBaseUrl(server); setServer(getBaseUrl()); sync.syncNow(true); }} />
        </Card>

        <Button title="Log out" kind="outline" icon="log-out-outline" onPress={confirmLogout} />
      </ScrollView>
    </Screen>
  );
}
