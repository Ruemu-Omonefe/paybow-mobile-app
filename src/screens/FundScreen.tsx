/**
 * ADD MONEY (simulated funding – no real bank). Needs a connection:
 *   enter amount -> confirm -> backend initiates + (simulated gateway) pays + verifies the reference and returns a signed
 *   confirmation -> ONE atomic local transaction (reference not yet credited, CREDIT ledger entry, balance up,
 *   PENDING_SYNC, history row) -> synced to the backend mirror later.
 */
import React, { useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { Screen, Card, Button, Input, Banner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { api } from '../services/api';
import * as repo from '../db/repo';
import { SERVER_PUBLIC_KEY } from '../config';
import { verifyFundingConfirmation } from '../lib/protocol';
import { formatNaira, parseNairaToKobo } from '../lib/money';
import { caption, colors, h1, h2, space } from '../theme';

const CHIPS = ['1000', '5000', '10000', '20000'];

export function FundScreen({ navigation }: any) {
  const { user } = useAuth();
  const sync = useSync();
  const [amountStr, setAmountStr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ amount: number; reference: string; balance: number } | null>(null);
  if (!user) return null;
  const amount = parseNairaToKobo(amountStr);

  const fund = async () => {
    if (!amount) return;
    setBusy(true);
    setError('');
    try {
      const { funding } = await api.fundingInitiate(amount);
      await api.fundingSimulate(funding.reference); // simulated payment gateway
      const { confirmation } = await api.fundingVerify(funding.reference);
      if (!verifyFundingConfirmation(confirmation, SERVER_PUBLIC_KEY) || confirmation.account_id !== user.id || confirmation.amount !== amount)
        throw new Error('The funding confirmation could not be verified.');
      const { balance } = await repo.recordFunding(user.id, confirmation, user.name);
      setDone({ amount, reference: confirmation.reference, balance });
      await sync.refreshLocal();
      sync.syncNow();
    } catch (e: any) {
      setError(e?.network ? 'Funding needs an internet connection. Try again when you are online.' : e?.message || 'Funding failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: 0 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {error ? <Banner icon="alert-circle-outline" tone="danger" text={error} /> : null}
        {!done && !confirming && (
          <Card style={{ gap: space.md }}>
            <Text style={h1}>Add money</Text>
            <Text style={caption}>Simulated funding for testing – no real bank is involved.</Text>
            <Input label="Amount (₦)" value={amountStr} onChangeText={setAmountStr} keyboardType="decimal-pad" placeholder="0.00" style={{ fontSize: 24, fontWeight: '800' }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CHIPS.map((c) => (
                <Pressable key={c} onPress={() => setAmountStr(c)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: amountStr === c ? colors.primary : colors.background }}>
                  <Text style={{ color: amountStr === c ? colors.background : colors.primary, fontWeight: '700' }}>₦{Number(c).toLocaleString()}</Text>
                </Pressable>
              ))}
            </View>
            <Button title="Continue" disabled={!amount} onPress={() => setConfirming(true)} />
          </Card>
        )}
        {!done && confirming && amount && (
          <Card style={{ gap: space.md }}>
            <Text style={h2}>Confirm funding</Text>
            <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{formatNaira(amount)}</Text>
            <Text style={caption}>This amount will be added to your wallet once Paybow verifies the payment reference.</Text>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button title="Back" kind="outline" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
              <Button title="Confirm" loading={busy} onPress={fund} style={{ flex: 1 }} />
            </View>
          </Card>
        )}
        {done && (
          <Card style={{ gap: space.md, alignItems: 'center' }}>
            <Text style={h2}>Wallet funded</Text>
            <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{formatNaira(done.amount)}</Text>
            <Text style={caption}>New balance {formatNaira(done.balance)} · Ref {done.reference.slice(0, 14)}…</Text>
            <Button title="Done" onPress={() => navigation.goBack()} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
