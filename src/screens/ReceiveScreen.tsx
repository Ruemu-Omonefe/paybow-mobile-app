/**
 * RECEIVE (receiver) – show identification QR (account ID, name, nonce, expiry, backend-signed credential);
 * scan the sender's payment QR -> validate (certificate, signature, expiry, receiver ID, unique txid, amount)
 * -> AUTO-CREDIT in one atomic local transaction (CREDIT ledger entry, evidence, signed acceptance, PENDING_SYNC).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { Screen, Card, Button, Banner, Row } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { acceptIncomingPayment, receiveQR } from '../services/paymentService';
import { Payment } from '../lib/protocol';
import { formatDateTime, formatNaira } from '../lib/money';
import { caption, colors, h1, h2, space } from '../theme';

type Step = 'show' | 'scan' | 'done';

export function ReceiveScreen() {
  const { user } = useAuth();
  const sync = useSync();
  const [step, setStep] = useState<Step>('show');
  const [code, setCode] = useState<{ qr: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [received, setReceived] = useState<{ payment: Payment; balance: number; at: number } | null>(null);
  const [error, setError] = useState('');
  const [expiredNote, setExpiredNote] = useState(false);
  const [busy, setBusy] = useState(false);

  const fresh = useCallback(async () => {
    if (!user) return;
    try { const r = await receiveQR(user.id); setCode({ qr: r.qr, expiresAt: r.expiresAt }); }
    catch (e: any) { setCode(null); setError(e?.message || 'Could not create your receiving code'); }
  }, [user]);
  const reset = useCallback(() => { setStep('show'); setReceived(null); setError(''); setExpiredNote(false); fresh(); }, [fresh]);
  useFocusEffect(useCallback(() => { reset(); return () => undefined; }, [reset]));

  // tick + auto-refresh the identification QR when it expires (very short expiry by design)
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setCode((c) => { if (c && n >= c.expiresAt) fresh(); return c; });
    }, 1000);
    return () => clearInterval(t);
  }, [fresh]);

  if (!user) return null;
  const restricted = !!sync.deadline?.restricted;

  const onScanPayment = async (raw: string) => {
    setBusy(true);
    const r = await acceptIncomingPayment(user.id, user.name, raw);
    setBusy(false);
    if (!r.ok) { setError(r.error); setExpiredNote(!!r.expired); setStep('show'); return; }
    setError('');
    setReceived({ payment: r.payment, balance: r.balance, at: Date.now() });
    setStep('done');
    await sync.refreshLocal();
    sync.syncNow();
  };

  if (step === 'scan') return <Screen><QRScanner title="Scan the payer's payment QR" onScan={onScanPayment} onCancel={() => setStep('show')} /></Screen>;

  const remaining = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text style={h1}>Receive</Text>
        {restricted ? <Banner icon="lock-closed-outline" tone="danger" text="Offline payments are paused until your pending transactions are synchronized. Connect to the internet." /> : null}
        {error ? <Banner icon="alert-circle-outline" tone="danger" text={error} /> : null}
        {expiredNote ? <Banner icon="hourglass-outline" text="The payment was rejected on this device and you were not credited." /> : null}

        {step === 'show' && code && (
          <>
            <Card style={{ alignItems: 'center', gap: space.md }}>
              <Text style={h2}>Your receiving code</Text>
              <Text style={caption}>Let the payer scan this to start the payment.</Text>
              <View style={{ padding: 14, backgroundColor: colors.white, borderRadius: 16 }}>
                <QRCode value={code.qr} size={230} color={colors.primary} backgroundColor={colors.white} ecl="M" />
              </View>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>{user.name}</Text>
              <Text style={{ color: colors.secondary, fontWeight: '600' }}>Refreshes in {remaining}s</Text>
            </Card>
            <Card style={{ gap: space.sm }}>
              <Text style={h2}>Then…</Text>
              <Text style={caption}>After the payer confirms your name and authorises with their PIN, they will show a signed payment code. Scan it – it is credited automatically.</Text>
              <Button title="Scan payment code" icon="scan-outline" loading={busy} disabled={restricted} onPress={() => { setError(''); setStep('scan'); }} />
            </Card>
          </>
        )}

        {step === 'done' && received && (
          <Card style={{ gap: space.sm, alignItems: 'center' }}>
            <Text style={h2}>Payment Received Successfully</Text>
            <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{formatNaira(received.payment.amount)}</Text>
            <View style={{ alignSelf: 'stretch' }}>
              <Row label="From" value={received.payment.payer_name} />
              <Row label="Reference" value={received.payment.transaction_id.slice(0, 13) + '…'} mono />
              <Row label="Date" value={formatDateTime(received.at)} />
              <Row label="New balance" value={formatNaira(received.balance)} />
            </View>
            <Banner icon="time-outline" text="Pending sync – Paybow confirms it when your device is online." />
            <Button title="Done" onPress={reset} style={{ alignSelf: 'stretch' }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
