/**
 * Key + PIN handling. Secrets live ONLY in the platform secure store (Keychain / Keystore):
 *  - the payer's Ed25519 private key (never leaves the device, never put in a QR code)
 *  - a salted hash of the payment PIN (so the PIN can be checked offline; the PIN itself is never stored)
 *  - the auth token
 */
import nacl from './nacl';
import { decodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';
import * as SecureStore from 'expo-secure-store';

const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const get = (k: string) => SecureStore.getItemAsync(k, opts);
const set = (k: string, v: string) => SecureStore.setItemAsync(k, v, opts);
const del = (k: string) => SecureStore.deleteItemAsync(k, opts);

export interface KeyPair {
  publicKey: string; // base64
  secretKey: string; // base64
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  return { publicKey: encodeBase64(kp.publicKey), secretKey: encodeBase64(kp.secretKey) };
}

export const saveKeyPair = (userId: string, kp: KeyPair) => set(`pb_key_${userId}`, JSON.stringify(kp));
export async function loadKeyPair(userId: string): Promise<KeyPair | null> {
  const raw = await get(`pb_key_${userId}`);
  return raw ? (JSON.parse(raw) as KeyPair) : null;
}

/* ---- PIN ---- */
function hashPin(pin: string, salt: Uint8Array): string {
  let h = nacl.hash(new Uint8Array([...salt, ...decodeUTF8(pin)]));
  for (let i = 0; i < 3000; i++) h = nacl.hash(new Uint8Array([...h, ...salt])); // simple key stretching
  return encodeBase64(h);
}

export async function setPin(userId: string, pin: string) {
  const salt = nacl.randomBytes(16);
  await set(`pb_pin_${userId}`, JSON.stringify({ salt: encodeBase64(salt), hash: hashPin(pin, salt) }));
}
export async function hasPin(userId: string) {
  return !!(await get(`pb_pin_${userId}`));
}
export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const raw = await get(`pb_pin_${userId}`);
  if (!raw) return false;
  const { salt, hash } = JSON.parse(raw);
  return hashPin(pin, decodeBase64(salt)) === hash;
}

/* ---- session ---- */
export const saveSession = (token: string, userJson: string) =>
  Promise.all([set('pb_token', token), set('pb_user', userJson)]);
export async function loadSession(): Promise<{ token: string; user: string } | null> {
  const [token, user] = await Promise.all([get('pb_token'), get('pb_user')]);
  return token && user ? { token, user } : null;
}
export const clearSession = () => Promise.all([del('pb_token'), del('pb_user')]);
