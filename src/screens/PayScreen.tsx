/**
 * PAY (sender) – receiver-first offline flow:
 *   scan receiver identification QR (format / expiry / credential signature checked)
 *   -> confirm receiver name + account ID -> amount (min, balance, daily allowance) -> PIN
 *   -> ONE atomic local transaction (debit, ledger, daily total, PENDING_SYNC, dependencies) -> signed payment QR.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { Screen, Card, Button, Input, Banner, Row } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { createPayment, validateRecipientQr } from '../services/paymentService';
import { Payment, RecipientIdentity } from '../lib/protocol';
import { MIN_PAYMENT_KOBO } from '../config';
import { formatNaira, parseNairaToKobo } from '../lib/money';
import { caption, colors, h1, h2, space } from '../theme';

type Step = 'start' | 'scan' | 'confirm' | 'amount' | 'pin' | 'qr' | 'done';

export function PayScreen() {
  const { user } = useAuth();
  const sync = useSync();
  const [step, setStep] = useState<Step>('start');
  const [recipient, setRecipient] = useState<RecipientIdentity | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [pin, setPin] = useState('');
  const [tx, setTx] = useState<Payment | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const reset = useCallback(() => {
    setStep('start'); setRecipient(null); setAmountStr(''); setPin(''); setTx(null); setQr(''); setError(''); setBusy(false);
  }, []);
  useFocusEffect(useCallback(() => () => reset(), [reset])); // leaving the tab discards the screen state (a created payment stays pending)

  useEffect(() => {
    if (step !== 'qr') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  if (!user) return null;
  const amount = parseNairaToKobo(amountStr);
  const restricted = !!sync.deadline?.restricted;
  const belowMin = amount !== null && amount < MIN_PAYMENT_KOBO;
  const overBalance = amount !== null && amount > (sync.balance ?? 0);
  const overDaily = amount !== null && amount > sync.dailyRemaining;
  const amountOk = amount !== null && !belowMin && !overBalance && !overDaily;

  /* scan + validate the receiver's identification QR */
  const onScanRecipient = (raw: string) => {
    const r = validateRecipientQr(raw, user.id);
    if (!r.ok) { setError(r.error); setStep('start'); return; }
    setError('');
    setRecipient(r.recipient);
    setStep('confirm');
  };

  /* PIN-authorised atomic payment creation */
  const authorise = async () => {
    if (!recipient || !amount) return;
    setBusy(true);
    setError('');
    try {
      const out = await createPayment(user.id, user.name, recipient, amount, pin);
      setTx(out.payment);
      setQr(out.qr);
      setNow(Date.now());
      setStep('qr');
      await sync.refreshLocal();
    } catch (e: any) {
      setError(e?.message || 'Could not create the payment');
      if (e instanceof repo.LocalError) setStep('amount');
    } finally {
      setBusy(false);
      setPin('');
    }
  };

  /* the payer confirms the receiver scanned it */
  const confirmScanned = async () => {
    if (!tx) return;
    setBusy(true);
    try {
      await repo.markDelivered(user.id, tx.transaction_id);
      setQr('');
      setStep('done');
      await sync.refreshLocal();
      sync.syncNow(); // no-op when offline
    } catch (e: any) {
      setError(e?.message || 'Could not update the transaction');
    } finally {
      setBusy(false);
    }
  };

  /* QR closed without a confirmed scan: the payment stays pending; if it expires unscanned it is marked EXPIRED */
  const closeNotScanned = async () => {
    setQr('');
    await sync.refreshLocal();
    reset();
  };

  /* ------------------------------------------------------------------ render */
  if (step === 'scan') return <Screen><QRScanner title="Scan the receiver's QR code" onScan={onScanRecipient} onCancel={() => setStep('start')} /></Screen>;

  const remaining = tx ? Math.max(0, Math.round((tx.expires_at - now) / 1000)) : 0;
  const expired = step === 'qr' && remaining === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={h1}>Pay</Text>
        {restricted ? <Banner icon="lock-closed-outline" tone="danger" text="Offline payments are paused until your pending transactions are synchronized. Connect to the internet." /> : null}
        {error ? <Banner icon="alert-circle-outline" tone="danger" text={error} /> : null}

        {step === 'start' && (
          <Card style={{ gap: space.md }}>
            <Text style={h2}>Scan to pay</Text>
            <Text style={caption}>
              Ask the receiver to open Receive and show their QR code. Works with or without internet – your wallet is debited on this
              device and the payment stays Pending sync until Paybow confirms it.
            </Text>
            <Button title="Scan receiver QR" icon="scan-outline" loading={busy} disabled={restricted} onPress={() => { setError(''); setStep('scan'); }} />
          </Card>
        )}

        {step === 'confirm' && recipient && (
          <Card style={{ gap: space.sm }}>
            <Text style={caption}>Confirm the receiver</Text>
            <Text style={[h1, { fontSize: 24 }]}>{recipient.name}</Text>
            <Row label="Account ID" value={recipient.walletId} mono />
            <Text style={{ color: colors.success, fontWeight: '600', fontSize: 12 }}>✓ Identity credential verified (signed by Paybow)</Text>
            <Text style={caption}>Check that this is the person you intend to pay.</Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Button title="Cancel" kind="outline" onPress={reset} style={{ flex: 1 }} />
              <Button title="Yes, continue" onPress={() => { setError(''); setStep('amount'); }} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {step === 'amount' && recipient && (
          <Card style={{ gap: space.sm }}>
            <Text style={caption}>Paying</Text>
            <Text style={[h1, { fontSize: 24 }]}>{recipient.name}</Text>
            <View style={{ height: space.md }} />
            <Input label="Amount (₦)" value={amountStr} onChangeText={setAmountStr} keyboardType="decimal-pad" placeholder="0.00" style={{ fontSize: 24, fontWeight: '800' }} />
            {amountStr !== '' && amount === null && <Text style={{ color: colors.danger }}>Enter a valid amount (max 2 decimals).</Text>}
            {belowMin && <Text style={{ color: colors.danger }}>Minimum payment is {formatNaira(MIN_PAYMENT_KOBO)}.</Text>}
            {!belowMin && overBalance && <Text style={{ color: colors.danger }}>Insufficient wallet balance.</Text>}
            {!belowMin && !overBalance && overDaily && <Text style={{ color: colors.danger }}>Above your remaining daily offline allowance.</Text>}
            <Text style={caption}>Available: {formatNaira(sync.balance ?? 0)} · Daily allowance left: {formatNaira(sync.dailyRemaining)}</Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Button title="Cancel" kind="outline" onPress={reset} style={{ flex: 1 }} />
              <Button title="Continue" disabled={!amountOk} onPress={() => { setError(''); setStep('pin'); }} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {step === 'pin' && recipient && amount && (
          <Card style={{ gap: space.sm }}>
            <Text style={h2}>Confirm payment</Text>
            <Row label="To" value={recipient.name} />
            <Row label="Amount" value={formatNaira(amount)} />
            <View style={{ height: space.md }} />
            <Input label="Enter your PIN to authorise" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button title="Back" kind="outline" onPress={() => { setPin(''); setStep('amount'); }} style={{ flex: 1 }} />
              <Button title="Authorise" loading={busy} disabled={pin.length < 4} onPress={authorise} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {step === 'qr' && tx && recipient && (
          <Card style={{ alignItems: 'center', gap: space.md }}>
            <Text style={h2}>Show this to {recipient.name}</Text>
            <Text style={caption}>Signed one-time payment code · {formatNaira(tx.amount)}</Text>
            <View style={{ padding: 14, backgroundColor: colors.white, borderRadius: 16, opacity: expired ? 0.2 : 1 }}>
              <QRCode value={qr} size={240} color={colors.primary} backgroundColor={colors.white} ecl="L" />
            </View>
            <Text style={{ color: expired ? colors.danger : colors.secondary, fontWeight: '700' }}>
              {expired ? 'Code expired – if it was not scanned, your money is refunded after sync' : `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
            </Text>
            <Text style={[caption, { textAlign: 'center' }]}>Your wallet has already been debited. When the receiver shows "Payment Received Successfully", tap the button below.</Text>
            <Button title="Receiver scanned it ✓" loading={busy} onPress={confirmScanned} style={{ alignSelf: 'stretch' }} />
            <Button title="Close (not scanned)" kind="outline" onPress={closeNotScanned} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}

        {step === 'done' && tx && recipient && (
          <Card style={{ gap: space.md, alignItems: 'center' }}>
            <Text style={h2}>Payment recorded</Text>
            <Text style={{ color: colors.primary, fontSize: 30, fontWeight: '800' }}>{formatNaira(tx.amount)}</Text>
            <Text style={caption}>to {recipient.name}</Text>
            <Banner icon="time-outline" text="Status: Pending sync. Your wallet is debited; Paybow will confirm it when both devices have synchronized – see History." />
            <Button title="New payment" onPress={reset} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
