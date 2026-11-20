import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, Row, StatusChip, Banner, Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { formatDateTime, formatNaira } from '../lib/money';
import { colors, h1, space } from '../theme';

const EXPLAIN: Record<string, string> = {
  PENDING_SYNC: 'Recorded on this device and your wallet has already changed locally. Paybow confirms it at the next synchronization.',
  SYNCING: 'Being sent to Paybow now. Waiting for the final result.',
  CONFIRMED: 'Verified and applied by Paybow. Your server mirror wallet is updated.',
  REJECTED: 'Paybow rejected this transaction after verification. It is kept for investigation.',
  CONFLICT: 'Paybow found a conflict (for example, the sender could not cover it). It is kept for investigation.',
  EXPIRED: 'The payment QR expired before the receiver accepted it. It stays pending until Paybow establishes the receiver was not credited, then it is refunded.',
  REFUNDED: 'The receiver was never credited, so Paybow refunded this payment to your wallet.',
};

export function TxDetailScreen({ route }: any) {
  const { user } = useAuth();
  const sync = useSync();
  const [tx, setTx] = useState<repo.LocalTx | null>(null);
  const [deps, setDeps] = useState<{ depends_on_id: string; amount: number }[]>([]);
  const load = useCallback(async () => {
    if (user) setTx(await repo.getTransaction(user.id, route.params.id));
  }, [user, route.params.id]);
  useEffect(() => {
    load();
  }, [load, sync.version]);
  useEffect(() => { if (user && tx) repo.getDependencies(user.id, tx.transaction_id).then(setDeps); }, [user, tx?.transaction_id]);

  if (!tx) return null;
  const out = tx.role === 'PAYER';
  const funding = tx.kind === 'FUNDING';
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} style={{ backgroundColor: colors.background }}>
      <Card style={{ alignItems: 'center', gap: space.sm }}>
        <Text style={{ color: colors.muted }}>{funding ? 'Added to wallet' : out ? 'Sent to' : 'Received from'}</Text>
        <Text style={[h1, { fontSize: 22 }]}>{funding ? 'Wallet funding' : (out ? tx.recipient_name : tx.payer_name) || 'Unknown user'}</Text>
        <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{out ? '-' : '+'}{formatNaira(tx.amount)}</Text>
        <StatusChip status={tx.status} />
      </Card>
      <Banner icon="information-circle-outline" tone={tx.status === 'REJECTED' || tx.status === 'CONFLICT' ? 'danger' : 'accent'} text={EXPLAIN[tx.status]} />
      {tx.last_error && (tx.status === 'REJECTED' || tx.status === 'CONFLICT') && <Banner icon="alert-circle-outline" tone="danger" text={`Reason: ${tx.last_error}`} />}
      <Card>
        <Row label={funding ? 'Funding reference' : 'Transaction ID'} value={tx.transaction_id} mono />
        <Row label="Created" value={formatDateTime(tx.timestamp)} />
        {tx.resolved_at ? <Row label="Resolved by server" value={formatDateTime(tx.resolved_at)} /> : null}
        <Row label="Currency" value={tx.currency} />
        <Row label="Sync attempts" value={String(tx.attempts)} />
        {tx.refund_reference ? <Row label="Refund reference" value={tx.refund_reference} mono /> : null}
        {deps.length > 0 ? <Row label="Depends on" value={deps.map((d) => `${d.depends_on_id.slice(0, 8)}… (${formatNaira(d.amount)})`).join(', ')} /> : null}
        {tx.status === 'PENDING_SYNC' && tx.last_error ? <Row label="Last sync error" value={tx.last_error} /> : null}
      </Card>
      {(tx.status === 'PENDING_SYNC' || tx.status === 'SYNCING' || tx.status === 'EXPIRED') && <View><Button title="Retry sync now" icon="sync-outline" onPress={() => sync.syncNow(true)} loading={sync.syncing} /></View>}
    </ScrollView>
  );
}
