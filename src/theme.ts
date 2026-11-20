import { TextStyle, ViewStyle } from 'react-native';

/** Paybow palette (from the brand brief). */
export const colors = {
  primary: '#352319', // primary buttons, headings, navigation
  secondary: '#8A5638', // secondary buttons, icons, highlights
  background: '#FAF7F1', // main background, cards, input fields
  accent: '#B98F60', // accents, borders, status indicators
  // semantic status colours (only used for Accepted / Rejected / Conflict chips)
  success: '#3F7D4E',
  danger: '#A63D2F',
  warning: '#B7791F',
  white: '#FFFFFF',
  muted: '#7A6A5E',
};

export const radius = 16;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const h1: TextStyle = { fontSize: 26, fontWeight: '800', color: colors.primary, letterSpacing: -0.3 };
export const h2: TextStyle = { fontSize: 18, fontWeight: '700', color: colors.primary };
export const body: TextStyle = { fontSize: 15, color: colors.primary };
export const caption: TextStyle = { fontSize: 12, color: colors.muted };

export const card: ViewStyle = {
  backgroundColor: colors.background,
  borderRadius: radius,
  borderWidth: 1,
  borderColor: colors.accent,
  padding: space.lg,
};
