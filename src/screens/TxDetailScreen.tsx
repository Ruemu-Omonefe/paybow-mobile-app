import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, Row, StatusChip, Banner, Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { formatDateTime, formatNaira } from '../lib/money';
import { colors, h1, space } from '../theme';

const EXPLAIN: Record<string, string> = {
  PENDING: 'Stored on this device only. It is NOT a completed payment until Paybow accepts it.',
  SYNCING: 'Being sent to Paybow now. Waiting for the final result.',
  ACCEPTED: 'Validated and recorded by Paybow. The balances have been updated.',
  REJECTED: 'Paybow rejected this transaction. No money moved.',
  CONFLICT: 'Paybow found a conflict with another transaction state. No money moved.',
};

export function TxDetailScreen({ route }: any) {
  const { user } = useAuth();
  const sync = useSync();
  const [tx, setTx] = useState<repo.LocalTx | null>(null);
  const load = useCallback(async () => {
    if (user) setTx(await repo.getTransaction(user.id, route.params.id));
  }, [user, route.params.id]);
  useEffect(() => {
    load();
  }, [load, sync.version]);

  if (!tx) return null;
  const out = tx.role === 'PAYER';
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} style={{ backgroundColor: colors.background }}>
      <Card style={{ alignItems: 'center', gap: space.sm }}>
        <Text style={{ color: colors.muted }}>{out ? 'Sent to' : 'Received from'}</Text>
        <Text style={[h1, { fontSize: 22 }]}>{(out ? tx.recipient_name : tx.payer_name) || 'Unknown user'}</Text>
        <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{out ? '-' : '+'}{formatNaira(tx.amount)}</Text>
        <StatusChip status={tx.status} />
      </Card>
      <Banner icon="information-circle-outline" tone={tx.status === 'REJECTED' ? 'danger' : 'accent'} text={EXPLAIN[tx.status]} />
      {tx.last_error && (tx.status === 'REJECTED' || tx.status === 'CONFLICT') && <Banner icon="alert-circle-outline" tone="danger" text={`Reason: ${tx.last_error}`} />}
      <Card>
        <Row label="Transaction ID" value={tx.transaction_id} mono />
        <Row label="Created" value={formatDateTime(tx.timestamp)} />
        {tx.resolved_at ? <Row label="Resolved by server" value={formatDateTime(tx.resolved_at)} /> : null}
        <Row label="Currency" value={tx.currency} />
        <Row label="Sync attempts" value={String(tx.attempts)} />
        {tx.status === 'PENDING' && tx.last_error ? <Row label="Last sync error" value={tx.last_error} /> : null}
      </Card>
      {(tx.status === 'PENDING' || tx.status === 'SYNCING') && <View><Button title="Retry sync now" icon="sync-outline" onPress={() => sync.syncNow(true)} loading={sync.syncing} /></View>}
    </ScrollView>
  );
}
