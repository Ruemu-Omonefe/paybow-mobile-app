/**
 * PAY (sender / payer) – workflow steps 2-5 and 7-8 of section 3.3.3:
 *   scan recipient QR -> verify registered name -> enter amount -> PIN -> signed one-time payment QR
 *   -> payer confirms "receiver scanned" -> stored locally as PENDING and queued for sync.
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
import * as crypto from '../lib/crypto';
import { api } from '../services/api';
import { CURRENCY, PAYMENT_QR_TTL_MS, SignedTransaction, encodePaymentQR, newNonce, newTransactionId, parseRecipientQR, signTransaction } from '../lib/protocol';
import { formatNaira, parseNairaToKobo } from '../lib/money';
import { caption, colors, h1, h2, space } from '../theme';

type Step = 'start' | 'scan' | 'amount' | 'pin' | 'qr' | 'done';
interface Recipient { id: string; name: string; source: 'server' | 'saved' | 'qr' }

export function PayScreen() {
  const { user } = useAuth();
  const sync = useSync();
  const [step, setStep] = useState<Step>('start');
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [pin, setPin] = useState('');
  const [tx, setTx] = useState<SignedTransaction | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const reset = useCallback(() => {
    setStep('start'); setRecipient(null); setAmountStr(''); setPin(''); setTx(null); setQr(''); setError(''); setBusy(false);
  }, []);
  useFocusEffect(useCallback(() => () => reset(), [reset])); // leaving the tab discards an unsaved flow

  useEffect(() => {
    if (step !== 'qr') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  if (!user) return null;
  const amount = parseNairaToKobo(amountStr);
  const estimate = (sync.balance ?? 0) - sync.pendingOutgoing;

  /* step 2-3: scan recipient QR, show the registered name */
  const onScanRecipient = async (raw: string) => {
    const parsed = parseRecipientQR(raw);
    if (!parsed.ok) { setError(parsed.error); setStep('start'); return; }
    const q = parsed.value;
    if (q.rid === user.id) { setError('You cannot pay yourself.'); setStep('start'); return; }
    setBusy(true);
    let r: Recipient = { id: q.rid, name: q.nm || 'Unknown', source: 'qr' };
    try {
      const u = await api.user(q.rid); // authoritative registered name
      await repo.upsertUser(u);
      r = { id: u.id, name: u.name, source: 'server' };
    } catch (e: any) {
      if (e?.status === 404) { setError('Recipient not found on Paybow.'); setStep('start'); setBusy(false); return; }
      const cached = await repo.getCachedUser(q.rid);
      if (cached) r = { id: q.rid, name: cached.display_name, source: 'saved' };
    }
    setBusy(false);
    setError('');
    setRecipient(r);
    setStep('amount');
  };

  /* step 4-5: PIN check, new transaction id/nonce, sign with the payer's private key */
  const authorise = async () => {
    if (!recipient || !amount) return;
    setBusy(true);
    setError('');
    try {
      if (!(await crypto.verifyPin(user.id, pin))) { setError('Incorrect PIN.'); setPin(''); return; }
      const kp = await crypto.loadKeyPair(user.id);
      if (!kp) { setError('Signing key missing on this device. Log out and log in again.'); return; }
      const ts = Date.now();
      const signed = signTransaction(
        { transaction_id: newTransactionId(), payer_id: user.id, recipient_id: recipient.id, amount, currency: CURRENCY, timestamp: ts, nonce: newNonce(), expires_at: ts + PAYMENT_QR_TTL_MS },
        kp.secretKey
      );
      const mine = await repo.getCachedUser(user.id);
      setTx(signed);
      setQr(encodePaymentQR(signed, mine?.display_name || user.name, kp.publicKey));
      setNow(Date.now());
      setStep('qr');
    } finally {
      setBusy(false);
      setPin('');
    }
  };

  /* step 7-8: the payer confirms the receiver scanned it -> persist locally BEFORE any network call */
  const confirmScanned = async () => {
    if (!tx || !recipient) return;
    setBusy(true);
    try {
      await repo.insertLocalTransaction(user.id, 'PAYER', tx, { payer: user.name, recipient: recipient.name });
      setQr(''); // one-time QR: gone once recorded
      setStep('done');
      await sync.refreshLocal();
      sync.syncNow(); // no-op (stays PENDING) when offline
    } catch (e: any) {
      setError(e?.message || 'Could not save the transaction');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------------ render */
  if (step === 'scan') return <Screen><QRScanner title="Scan the receiver's QR code" onScan={onScanRecipient} onCancel={() => setStep('start')} /></Screen>;

  const remaining = tx ? Math.max(0, Math.round((tx.expires_at - now) / 1000)) : 0;
  const expired = step === 'qr' && remaining === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={h1}>Pay</Text>
        {error ? <Banner icon="alert-circle-outline" tone="danger" text={error} /> : null}

        {step === 'start' && (
          <Card style={{ gap: space.md }}>
            <Text style={h2}>Scan to pay</Text>
            <Text style={caption}>
              Ask the receiver to open Receive and show their QR code. Works with or without internet – the payment is recorded on this
              device and stays Pending until Paybow confirms it.
            </Text>
            <Button title="Scan receiver QR" icon="scan-outline" loading={busy} onPress={() => { setError(''); setStep('scan'); }} />
          </Card>
        )}

        {step === 'amount' && recipient && (
          <Card style={{ gap: space.sm }}>
            <Text style={caption}>Paying</Text>
            <Text style={[h1, { fontSize: 24 }]}>{recipient.name}</Text>
            <Text style={{ color: recipient.source === 'qr' ? colors.warning : colors.success, fontWeight: '600', fontSize: 12 }}>
              {recipient.source === 'server' ? '✓ Registered name verified with Paybow'
                : recipient.source === 'saved' ? '✓ Registered name from this device\'s saved contacts'
                : '⚠ Offline – name taken from the QR code, not yet verified. Check it with the receiver.'}
            </Text>
            <View style={{ height: space.md }} />
            <Input label="Amount (₦)" value={amountStr} onChangeText={setAmountStr} keyboardType="decimal-pad" placeholder="0.00" style={{ fontSize: 24, fontWeight: '800' }} />
            {amountStr !== '' && amount === null && <Text style={{ color: colors.danger }}>Enter a valid amount (max 2 decimals).</Text>}
            {amount !== null && amount > estimate && (
              <Banner icon="warning-outline" text={`Above your last known available balance (${formatNaira(Math.max(0, estimate))}). Paybow will make the final decision and may reject it.`} />
            )}
            <Text style={caption}>Available (est.): {formatNaira(Math.max(0, estimate))}</Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Button title="Cancel" kind="outline" onPress={reset} style={{ flex: 1 }} />
              <Button title="Continue" disabled={!amount} onPress={() => { setError(''); setStep('pin'); }} style={{ flex: 1 }} />
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
              {expired ? 'Code expired – start again' : `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
            </Text>
            <Text style={[caption, { textAlign: 'center' }]}>When the receiver has scanned it successfully, tap the button below to record the payment.</Text>
            <Button title="Receiver scanned it ✓" loading={busy} disabled={expired} onPress={confirmScanned} style={{ alignSelf: 'stretch' }} />
            <Button title="Cancel" kind="outline" onPress={reset} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}

        {step === 'done' && tx && recipient && (
          <Card style={{ gap: space.md, alignItems: 'center' }}>
            <Text style={h2}>Payment recorded</Text>
            <Text style={{ color: colors.primary, fontSize: 30, fontWeight: '800' }}>{formatNaira(tx.amount)}</Text>
            <Text style={caption}>to {recipient.name}</Text>
            <Banner icon="time-outline" text="Status: PENDING. Not paid until Paybow confirms it – check History for the final result (Accepted / Rejected / Conflict)." />
            <Button title="New payment" onPress={reset} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
