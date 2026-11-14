import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View, Pressable } from 'react-native';
import { Screen, Button, Input, Card } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { caption, colors, h1, h2, space } from '../theme';
import { getBaseUrl, setBaseUrl } from '../services/api';

const logo = require('../../assets/logo.png');

function PinSetup() {
  const { completePin, logout } = useAuth();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) return setErr('PIN must be 4-6 digits');
    if (pin !== confirm) return setErr('PINs do not match');
    await completePin(pin);
  };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={h2}>Set your payment PIN</Text>
      <Text style={[caption, { marginBottom: space.md }]}>
        This device needs a PIN to authorise payments (it works offline and is never sent anywhere).
      </Text>
      <Input label="PIN" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
      <Input label="Confirm PIN" value={confirm} onChangeText={setConfirm} keyboardType="number-pad" secureTextEntry maxLength={6} />
      {err ? <Text style={{ color: colors.danger, marginBottom: 8 }}>{err}</Text> : null}
      <Button title="Save PIN" onPress={submit} />
      <Button title="Log out" kind="outline" onPress={logout} style={{ marginTop: 8 }} />
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
    } catch (e: any) {
      setErr(e?.network ? `${e.message}. Registration and first login need a connection to ${getBaseUrl()}.` : e?.message || 'Something went wrong');
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
                {mode === 'login' ? 'Log in to your Paybow test wallet.' : 'You will get a simulated test balance – no real money.'}
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
          <Pressable onPress={() => setShowServer(!showServer)} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={caption}>Server settings</Text>
          </Pressable>
          {showServer && (
            <View style={{ marginTop: 8 }}>
              <Input label="Server URL" value={server} onChangeText={setServer} keyboardType="url" />
              <Button title="Save server URL" kind="outline" onPress={() => setBaseUrl(server)} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
