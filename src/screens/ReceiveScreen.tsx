/**
 * RECEIVE (recipient) – workflow steps 1 and 6-8:
 *   show recipient QR (id + nonce + short expiry) -> scan the payer's signed payment QR
 *   -> validate signature/expiry/details -> accept -> stored locally as PENDING and queued for sync.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { Screen, Card, Button, Banner, Row } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as repo from '../db/repo';
import { api } from '../services/api';
import { PaymentQR, RECIPIENT_QR_TTL_MS, encodeRecipientQR, newNonce, parsePaymentQR, verifyTransaction } from '../lib/protocol';
import { formatNaira } from '../lib/money';
import { caption, colors, h1, h2, space } from '../theme';

type Step = 'show' | 'scan' | 'review' | 'done';
type Trust = 'verified' | 'embedded';

export function ReceiveScreen() {
  const { user } = useAuth();
  const sync = useSync();
  const [step, setStep] = useState<Step>('show');
  const [code, setCode] = useState<{ n: string; x: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [payment, setPayment] = useState<PaymentQR | null>(null);
  const [payerName, setPayerName] = useState('');
  const [trust, setTrust] = useState<Trust>('embedded');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const fresh = useCallback(() => setCode({ n: newNonce(), x: Date.now() + RECIPIENT_QR_TTL_MS }), []);
  const reset = useCallback(() => { setStep('show'); setPayment(null); setError(''); fresh(); }, [fresh]);
  useFocusEffect(useCallback(() => { reset(); return () => undefined; }, [reset]));

  // tick + auto-refresh the recipient QR when it expires (very short expiry by design)
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setCode((c) => (c && n >= c.x ? { n: newNonce(), x: n + RECIPIENT_QR_TTL_MS } : c));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!user) return null;

  /* step 6: validate the scanned payment QR (untrusted input) */
  const onScanPayment = async (raw: string) => {
    const parsed = parsePaymentQR(raw);
    if (!parsed.ok) { setError(parsed.error); setStep('show'); return; }
    const p = parsed.value;
    const t = p.tx;
    if (t.recipient_id !== user.id) { setError('This payment is addressed to someone else.'); setStep('show'); return; }
    if (t.payer_id === user.id) { setError('You cannot receive your own payment.'); setStep('show'); return; }
    if (await repo.getTransaction(user.id, t.transaction_id)) { setError('This payment is already recorded on this device.'); setStep('show'); return; }

    setBusy(true);
    let name = p.pn || 'Unknown payer';
    let registeredKey: string | null = (await repo.getCachedUser(t.payer_id))?.public_key ?? null;
    const cachedName = (await repo.getCachedUser(t.payer_id))?.display_name;
    if (cachedName) name = cachedName;
    try {
      const u = await api.user(t.payer_id); // registered name + registered public key
      await repo.upsertUser(u);
      name = u.name;
      registeredKey = u.public_key;
    } catch { /* offline: fall back to cache / embedded key */ }

    // verify the payer's signature: against the REGISTERED key when we know it, else the key in the QR
    // (self-consistency only – the backend always re-verifies against the registered key at sync).
    if (registeredKey && registeredKey !== p.pk) {
      setBusy(false); setError('Payer key does not match the one on record. Connect to the internet and try again.'); setStep('show'); return;
    }
    if (!verifyTransaction(t, registeredKey || p.pk)) {
      setBusy(false); setError('Invalid signature – this payment code was altered or forged.'); setStep('show'); return;
    }
    setTrust(registeredKey ? 'verified' : 'embedded');
    setPayerName(name);
    setPayment(p);
    setError('');
    setBusy(false);
    setStep('review');
  };

  /* step 7-8: accept -> persist locally as PENDING with the same transaction_id, then try to sync */
  const accept = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      const r = await repo.insertLocalTransaction(user.id, 'RECIPIENT', payment.tx, { payer: payerName, recipient: user.name });
      if (r === 'exists') { setError('This payment is already recorded on this device.'); setStep('show'); return; }
      setStep('done');
      await sync.refreshLocal();
      sync.syncNow();
    } catch (e: any) {
      setError(e?.message || 'Could not save the transaction');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'scan') return <Screen><QRScanner title="Scan the payer's payment QR" onScan={onScanPayment} onCancel={() => setStep('show')} /></Screen>;

  const remaining = code ? Math.max(0, Math.round((code.x - now) / 1000)) : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text style={h1}>Receive</Text>
        {error ? <Banner icon="alert-circle-outline" tone="danger" text={error} /> : null}

        {step === 'show' && code && (
          <>
            <Card style={{ alignItems: 'center', gap: space.md }}>
              <Text style={h2}>Your receiving code</Text>
              <Text style={caption}>Let the payer scan this to start the payment.</Text>
              <View style={{ padding: 14, backgroundColor: colors.white, borderRadius: 16 }}>
                <QRCode value={encodeRecipientQR({ rid: user.id, nm: user.name, n: code.n, x: code.x })} size={230} color={colors.primary} backgroundColor={colors.white} ecl="M" />
              </View>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>{user.name}</Text>
              <Text style={{ color: colors.secondary, fontWeight: '600' }}>Refreshes in {remaining}s</Text>
            </Card>
            <Card style={{ gap: space.sm }}>
              <Text style={h2}>Then…</Text>
              <Text style={caption}>After the payer authorises with their PIN, they will show you a signed payment code. Scan it here.</Text>
              <Button title="Scan payment code" icon="scan-outline" loading={busy} onPress={() => { setError(''); setStep('scan'); }} />
            </Card>
          </>
        )}

        {step === 'review' && payment && (
          <Card style={{ gap: space.sm }}>
            <Text style={h2}>Review payment</Text>
            <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{formatNaira(payment.tx.amount)}</Text>
            <Row label="From" value={payerName} />
            <Row label="To" value={user.name} />
            <Row label="Transaction ID" value={payment.tx.transaction_id.slice(0, 13) + '…'} mono />
            <Row label="Signature" value={trust === 'verified' ? '✓ Verified against registered key' : '✓ Valid · registered key confirmed at sync'} />
            <Banner icon="information-circle-outline" text="Accepting records this payment as PENDING. It is only final once Paybow confirms it." />
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Button title="Reject" kind="outline" onPress={reset} style={{ flex: 1 }} />
              <Button title="Accept" loading={busy} onPress={accept} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {step === 'done' && payment && (
          <Card style={{ gap: space.md, alignItems: 'center' }}>
            <Text style={h2}>Payment recorded</Text>
            <Text style={{ color: colors.primary, fontSize: 30, fontWeight: '800' }}>{formatNaira(payment.tx.amount)}</Text>
            <Text style={caption}>from {payerName}</Text>
            <Banner icon="time-outline" text="Status: PENDING. The money shows in your balance only after Paybow accepts it." />
            <Button title="Done" onPress={reset} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
