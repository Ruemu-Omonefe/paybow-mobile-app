/**
 * Default API address. Override with EXPO_PUBLIC_API_URL, or change it in the app (Server URL field).
 *  - Android emulator  : http://10.0.2.2:4000
 *  - iOS simulator     : http://localhost:4000
 *  - Physical phone    : http://<your-computer-LAN-IP>:4000  (phone and computer on the same Wi-Fi)
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

const developmentHost = Constants.expoConfig?.hostUri?.split(':')[0];
const defaultHost = Device.isDevice && developmentHost
  ? developmentHost
  : Platform.OS === 'android'
    ? '10.0.2.2'
    : 'localhost';

export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || `http://${defaultHost}:4000`;
console.log('Backend API:', DEFAULT_API_URL);

export const SYNC_INTERVAL_MS = 20_000;
export const REQUEST_TIMEOUT_MS = 8_000;
export const SYNC_BATCH_SIZE = 20;
