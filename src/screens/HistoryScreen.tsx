import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, TxRow, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { caption, colors, h1, space } from '../theme';

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'FAILED', label: 'Rejected / Conflict' },
] as const;

export function HistoryScreen() {
  const { user } = useAuth();
  const sync = useSync();
  const nav = useNavigation<any>();
  const [items, setItems] = useState<repo.LocalTx[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (user) setItems(await repo.listTransactions(user.id));
  }, [user]);
  useEffect(() => {
    load();
  }, [load, sync.version]);

  const shown = items.filter((t) =>
    filter === 'ALL' ? true : filter === 'PENDING' ? t.status === 'PENDING' || t.status === 'SYNCING' : filter === 'ACCEPTED' ? t.status === 'ACCEPTED' : t.status === 'REJECTED' || t.status === 'CONFLICT'
  );

  return (
    <Screen>
      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <Text style={h1}>History</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.md }}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: filter === f.key ? colors.primary : colors.background }}>
              <Text style={{ color: filter === f.key ? colors.background : colors.primary, fontWeight: '700', fontSize: 13 }}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(t) => t.transaction_id}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.secondary} onRefresh={async () => { setRefreshing(true); await sync.syncNow(true); await load(); setRefreshing(false); }} />}
        renderItem={({ item }) => <TxRow tx={item} onPress={() => nav.navigate('TxDetail', { id: item.transaction_id })} />}
        ListEmptyComponent={<Card><Text style={[caption, { textAlign: 'center' }]}>Nothing here yet.</Text></Card>}
      />
    </Screen>
  );
}
