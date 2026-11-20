/**
 * Default API address. Override with EXPO_PUBLIC_API_URL, or change it in the app (Server URL field).
 *  - Android emulator  : http://10.0.2.2:4000
 *  - iOS simulator     : http://localhost:4000
 *  - Physical phone    : http://<your-computer-LAN-IP>:4000  (phone and computer on the same Wi-Fi)
 */
import { Platform } from 'react-native';


  import Constants from 'expo-constants';

// export const DEFAULT_API_URL =
//   process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');

const hostUri = Constants.expoConfig?.hostUri;
const host = hostUri?.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d+$/)?.[1];
const lanHost =
  host && host !== '0.0.0.0' && !host.startsWith('127.') && host.split('.').every((part) => Number(part) <= 255)
    ? host
    : undefined;

export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (lanHost
    ? `http://${lanHost}:4000`
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:4000'
      : 'http://localhost:4000');

/**
 * EMBEDDED VERIFICATION KEY – the public half of the backend's signing key. Every certificate / identity credential
 * and funding confirmation is checked against it, offline. This is the DEMO key matching backend/.env.example;
 * after running `npm run keygen` in the backend, replace it here (or set EXPO_PUBLIC_SERVER_PUBLIC_KEY).
 */
export const SERVER_PUBLIC_KEY = process.env.EXPO_PUBLIC_SERVER_PUBLIC_KEY || 'mfDnWb0E2TU1/zqoVCsNP0ok+Ou5gxIiKUN7Xq+8qV8=';

export const SYNC_INTERVAL_MS = 20_000;
export const REQUEST_TIMEOUT_MS = 8_000;
export const SYNC_BATCH_SIZE = 20;

/** Offline-risk controls (variable – the report proposes 72 h and a daily offline limit). */
export const SYNC_DEADLINE_MS = Number(process.env.EXPO_PUBLIC_SYNC_DEADLINE_HOURS || 72) * 60 * 60 * 1000;
export const DAILY_OFFLINE_LIMIT_KOBO = Number(process.env.EXPO_PUBLIC_DAILY_OFFLINE_LIMIT_KOBO || 5_000_000); // ₦50,000
export const MIN_PAYMENT_KOBO = 10_000; // ₦100
export const MAX_PAYMENT_KOBO = 50_000_000;
export const CERT_RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
