import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle, StyleProp } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { caption, card, colors, radius, space } from '../theme';
import { TxStatus } from '../lib/protocol';
import { formatNaira, formatDateTime } from '../lib/money';
import type { LocalTx } from '../db/repo';

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: colors.background }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[card, style]}>{children}</View>;
}

type BtnKind = 'primary' | 'secondary' | 'outline';
export function Button({ title, onPress, kind = 'primary', loading, disabled, icon, style }: {
  title: string; onPress: () => void; kind?: BtnKind; loading?: boolean; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? colors.primary : kind === 'secondary' ? colors.secondary : 'transparent';
  const fg = kind === 'outline' ? colors.primary : colors.background;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: radius, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          borderWidth: kind === 'outline' ? 1.5 : 0, borderColor: colors.accent, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Input({ label, style, ...p }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={[caption, { marginBottom: 4, fontWeight: '600' }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        {...p}
        style={[{ backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.primary }, style]}
      />
    </View>
  );
}

const STATUS_STYLE: Record<TxStatus, { bg: string; fg: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  PENDING_SYNC: { bg: colors.accent, fg: colors.primary, label: 'Pending sync', icon: 'time-outline' },
  SYNCING: { bg: colors.secondary, fg: colors.background, label: 'Syncing', icon: 'sync-outline' },
  CONFIRMED: { bg: colors.success, fg: colors.white, label: 'Confirmed', icon: 'checkmark-circle-outline' },
  REJECTED: { bg: colors.danger, fg: colors.white, label: 'Rejected', icon: 'close-circle-outline' },
  CONFLICT: { bg: colors.warning, fg: colors.white, label: 'Conflict', icon: 'warning-outline' },
  EXPIRED: { bg: colors.warning, fg: colors.white, label: 'Expired', icon: 'hourglass-outline' },
  REFUNDED: { bg: colors.secondary, fg: colors.background, label: 'Refunded', icon: 'return-up-back-outline' },
};
export const statusLabel = (s: TxStatus) => STATUS_STYLE[s].label;

export function StatusChip({ status }: { status: TxStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: s.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Ionicons name={s.icon} size={13} color={s.fg} />
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700' }}>{s.label}</Text>
    </View>
  );
}

export function TxRow({ tx, onPress }: { tx: LocalTx; onPress: () => void }) {
  const out = tx.role === 'PAYER';
  const funding = tx.kind === 'FUNDING';
  const other = out ? tx.recipient_name : tx.payer_name;
  // wallet already moved locally; faded until the BACKEND confirms (or refunded/rejected)
  const counted = tx.status === 'CONFIRMED';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [card, { marginBottom: space.sm, opacity: pressed ? 0.85 : 1, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={funding ? 'add' : out ? 'arrow-up' : 'arrow-down'} size={20} color={colors.background} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{funding ? 'Wallet funding' : `${out ? 'To' : 'From'} ${other || 'Unknown user'}`}</Text>
        <Text style={caption}>{formatDateTime(tx.timestamp)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, opacity: counted ? 1 : 0.55 }}>{out ? '-' : '+'}{formatNaira(tx.amount)}</Text>
        <StatusChip status={tx.status} />
      </View>
    </Pressable>
  );
}

export function Banner({ icon, text, tone = 'accent' }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: 'accent' | 'primary' | 'danger' }) {
  const bg = tone === 'primary' ? colors.primary : tone === 'danger' ? colors.danger : colors.accent;
  const fg = tone === 'accent' ? colors.primary : colors.background;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600', flex: 1 }}>{text}</Text>
    </View>
  );
}

export function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.accent, gap: 16 }}>
      <Text style={caption}>{label}</Text>
      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right', fontFamily: mono ? 'monospace' : undefined }}>{value}</Text>
    </View>
  );
}
