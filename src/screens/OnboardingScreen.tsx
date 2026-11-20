import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../components/ui';
import { caption, colors, h1, space } from '../theme';

const logo = require('../../assets/logo.png');

const pages = [
  {
    title: 'Your money, in motion.',
    description: 'A simpler way to send and receive money, with every payment easy to follow.',
    eyebrow: 'MEET YOUR NEW WALLET',
  },
  {
    title: "Even offline, you're good.",
    description: "Make a payment without a connection. Paybow syncs and confirms it when you're back online.",
    eyebrow: 'PAYMENTS THAT KEEP MOVING',
  },
  {
    title: 'Feel good about every tap.',
    description: 'Your payment PIN authorises transactions on your device. Your activity stays easy to review.',
    eyebrow: 'MADE FOR PEACE OF MIND',
  },
];

function WalletIllustration() {
  return (
    <View style={{ flex: 1, backgroundColor: '#A96032', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ position: 'absolute', width: 230, height: 230, borderRadius: 115, backgroundColor: '#D99557', top: -105, right: -40, opacity: 0.75 }} />
      <View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#874626', bottom: -55, left: -20 }} />
      <View style={{ width: '78%', backgroundColor: colors.background, borderRadius: 20, padding: 18, transform: [{ rotate: '-4deg' }] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>PAYBOW WALLET</Text>
          <Ionicons name="wallet" size={20} color={colors.secondary} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 16 }}>Your wallet balance</Text>
        <Text style={{ color: colors.primary, fontSize: 29, fontWeight: '800', marginTop: 2 }}>₦ 0.00</Text>
        <View style={{ height: 1, backgroundColor: '#E8DCCB', marginVertical: 13 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#EAD4B8', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={17} color={colors.primary} />
          </View>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Ready for your first payment</Text>
        </View>
      </View>
      <View style={{ position: 'absolute', right: 24, bottom: 24, backgroundColor: '#E6F0D8', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6, transform: [{ rotate: '4deg' }] }}>
        <Ionicons name="checkmark-circle" size={18} color="#47734A" />
        <Text style={{ color: '#315B36', fontSize: 12, fontWeight: '800' }}>All yours</Text>
      </View>
    </View>
  );
}

function OfflineIllustration() {
  return (
    <View style={{ flex: 1, backgroundColor: '#29483E', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ position: 'absolute', width: 250, height: 250, borderRadius: 125, borderWidth: 1, borderColor: '#6E9181', opacity: 0.55 }} />
      <View style={{ position: 'absolute', width: 185, height: 185, borderRadius: 93, borderWidth: 1, borderColor: '#6E9181', opacity: 0.7 }} />
      <View style={{ width: 118, height: 118, borderRadius: 40, backgroundColor: '#F6E8D2', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] }}>
        <Ionicons name="cloud-offline" size={58} color="#29483E" />
      </View>
      <View style={{ position: 'absolute', top: 26, left: 22, backgroundColor: '#F6E8D2', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#D27842' }} />
        <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>OFFLINE MODE</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 24, right: 22, backgroundColor: '#D5E4D2', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 8, transform: [{ rotate: '4deg' }] }}>
        <Ionicons name="sync" size={18} color="#315B45" />
        <Text style={{ color: '#315B45', fontSize: 12, fontWeight: '800' }}>Syncs when you're back</Text>
      </View>
    </View>
  );
}

function SecureIllustration() {
  return (
    <View style={{ flex: 1, backgroundColor: '#E8D3B7', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ position: 'absolute', width: 230, height: 230, borderRadius: 115, backgroundColor: '#D8BC98', top: -115, left: -65 }} />
      <View style={{ position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: '#F2E5D4', bottom: -100, right: -55 }} />
      <View style={{ width: 138, height: 150, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="shield" size={138} color="#754A32" />
        <Ionicons name="checkmark" size={54} color="#F6E9D7" style={{ position: 'absolute', top: 48 }} />
      </View>
      <View style={{ position: 'absolute', top: 24, right: 22, backgroundColor: '#FAF7F1', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7, transform: [{ rotate: '5deg' }] }}>
        <Ionicons name="keypad" size={17} color="#754A32" />
        <Text style={{ color: '#754A32', fontSize: 12, fontWeight: '800' }}>Your PIN, your call</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 23, left: 22, backgroundColor: '#FAF7F1', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7, transform: [{ rotate: '-4deg' }] }}>
        <Ionicons name="receipt-outline" size={17} color="#754A32" />
        <Text style={{ color: '#754A32', fontSize: 12, fontWeight: '800' }}>Every detail, in view</Text>
      </View>
    </View>
  );
}

export function OnboardingScreen({
  onComplete,
  storageError,
}: {
  onComplete: () => Promise<void>;
  storageError?: string;
}) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = pages[page];

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your preference. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48, marginBottom: space.md }}>
          <Image source={logo} style={{ width: 104, height: 48 }} resizeMode="contain" />
          {page < pages.length - 1 ? (
            <Pressable accessibilityRole="button" onPress={finish} disabled={busy} hitSlop={10}>
              <Text style={{ color: colors.secondary, fontSize: 14, fontWeight: '800' }}>Skip</Text>
            </Pressable>
          ) : <View style={{ width: 32 }} />}
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ height: 230, borderRadius: 28, overflow: 'hidden', marginBottom: space.xl }}>
            {page === 0 ? <WalletIllustration /> : page === 1 ? <OfflineIllustration /> : <SecureIllustration />}
          </View>

          <Text style={{ color: colors.secondary, fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: space.sm }}>{current.eyebrow}</Text>
          <Text style={[h1, { fontSize: 32, lineHeight: 38, marginBottom: space.sm }]}>{current.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23, maxWidth: 340 }}>{current.description}</Text>
        </View>

        <View style={{ paddingTop: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to previous onboarding page"
              onPress={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0 || busy}
              hitSlop={10}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: page === 0 ? '#E6DED3' : colors.accent, alignItems: 'center', justifyContent: 'center', opacity: page === 0 ? 0.4 : 1 }}
            >
              <Ionicons name="arrow-back" size={18} color={colors.primary} />
            </Pressable>
            <View accessibilityLabel={`Page ${page + 1} of ${pages.length}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              {pages.map((item, index) => (
                <View key={item.eyebrow} style={{ width: index === page ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: index === page ? colors.primary : '#D9C8B3' }} />
              ))}
            </View>
            <Text style={{ width: 40, textAlign: 'right', color: colors.muted, fontSize: 12, fontWeight: '800' }}>0{page + 1}/03</Text>
          </View>
          {error || storageError ? <Text style={{ color: colors.danger, textAlign: 'center', marginBottom: space.md }}>{error || storageError}</Text> : null}
          <Button
            title={page === pages.length - 1 ? 'Get started' : 'Continue'}
            icon="arrow-forward"
            loading={busy}
            onPress={page === pages.length - 1 ? finish : () => setPage((value) => value + 1)}
            style={{ borderRadius: 14, minHeight: 54 }}
          />
          {page === pages.length - 1 ? (
            <Pressable onPress={finish} disabled={busy} style={{ alignItems: 'center', paddingTop: space.md }}>
              <Text style={[caption, { fontSize: 12 }]}>Already have an account? <Text style={{ color: colors.secondary, fontWeight: '800' }}>Sign in</Text></Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
