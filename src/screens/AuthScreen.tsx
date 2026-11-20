import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View, Pressable } from 'react-native';
import { Screen, Button, Input, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { caption, colors, h1, h2, space } from '../theme';
import { ApiError, getBaseUrl, setBaseUrl } from '../services/api';

const logo = require('../../assets/logo.png');

function PinSetup() {
  const { completePin, logout, pinMode } = useAuth();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setErr('');
    try {
      await logout();
    } catch (e) {
      setErr(e instanceof Error && 'network' in e && e.network
        ? 'Connect to the internet to log out and release this account for another phone.'
        : e instanceof Error ? e.message : 'Could not log out. Please try again.');
    }
  };
  const submit = async () => {
    setErr('');
    if (pinMode === 'unavailable') return;
    if (!/^\d{4,6}$/.test(pin)) return setErr('PIN must be 4-6 digits');
    setBusy(true);
    try {
      await completePin(pin);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not verify the payment PIN. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={h2}>
        {pinMode === 'migrate' ? 'Link your existing payment PIN' : pinMode === 'unavailable' ? 'PIN setup needed on your first device' : 'Confirm your payment PIN'}
      </Text>
      <Text style={[caption, { marginBottom: space.md }]}>
        {pinMode === 'migrate'
          ? 'Enter the PIN you already use on this device. This one-time step lets you confirm the same PIN on other phones.'
          : pinMode === 'unavailable'
            ? 'Your payment PIN has not been linked to your account yet. Open Paybow on the phone where you first created it and confirm the PIN there first.'
            : 'Enter the 4-6 digit PIN you first created. Paybow will verify it before saving it securely on this device.'}
      </Text>
      {pinMode !== 'unavailable' && (
        <Input label="Payment PIN" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
      )}
      {err ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text> : null}
      {pinMode !== 'unavailable' && (
        <Button title={pinMode === 'migrate' ? 'Link existing PIN' : 'Confirm PIN'} onPress={submit} loading={busy} />
      )}
      <Button title="Log out" kind="outline" onPress={signOut} style={{ marginTop: 8 }} />
    </Card>
  );
}

export function AuthScreen() {
  const { login, register, needsPin, user } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(getBaseUrl());

  const submit = async () => {
    setErr('');
    if (!email.includes('@') || password.length < 8) return setErr('Enter a valid email and a password of at least 8 characters.');
    if (mode === 'register') {
      if (name.trim().length < 2) return setErr('Enter your full name.');
      if (!/^\d{4,6}$/.test(pin)) return setErr('Payment PIN must be 4-6 digits.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password, pin);
    } catch (e: unknown) {
      if (mode === 'login' && e instanceof ApiError && e.status === 409) {
        setErr('This account is already signed in on another phone. Please log out on the other phone, then try again.');
      } else if (e instanceof ApiError && e.network) {
        setErr(`${e.message}. Registration and first login need a connection to ${getBaseUrl()}.`);
      } else {
        setErr(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: space.lg }}>
            <Image source={logo} style={{ width: 190, height: 190 }} resizeMode="contain" />
          </View>
          {user && needsPin ? (
            <PinSetup />
          ) : (
            <Card>
              <Text style={[h1, { marginBottom: 4 }]}>{mode === 'login' ? 'Welcome back' : 'Create account'}</Text>
              <Text style={[caption, { marginBottom: space.lg }]}>
                {mode === 'login' ? 'Log in to your Paybow test wallet.' : 'Create a new Paybow test wallet. You can use it to send and receive test payments, and to explore the app.'}
              </Text>
              {mode === 'register' && <Input label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />}
              <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
              <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
              {mode === 'register' && (
                <Input label="Payment PIN (4-6 digits)" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
              )}
              {err ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{err}</Text> : null}
              <Button title={mode === 'login' ? 'Log in' : 'Create account'} onPress={submit} loading={busy} />
              <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={{ color: colors.secondary, fontWeight: '700' }}>
                  {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
                </Text>
              </Pressable>
            </Card>
          )}
          {/* <Pressable onPress={() => setShowServer(!showServer)} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={caption}>Server settings</Text>
          </Pressable>
          {showServer && (
            <View style={{ marginTop: 8 }}>
              <Input label="Server URL" value={server} onChangeText={setServer} keyboardType="url" />
              <Button title="Save server URL" kind="outline" onPress={() => setBaseUrl(server)} />
            </View>
          )} */}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
