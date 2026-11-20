import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SyncProvider, useSync } from './src/context/SyncContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PayScreen } from './src/screens/PayScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TxDetailScreen } from './src/screens/TxDetailScreen';
import { FundScreen } from './src/screens/FundScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.background, card: colors.background, primary: colors.primary, text: colors.primary, border: colors.accent } };

const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['wallet', 'wallet-outline'],
  Pay: ['scan', 'scan-outline'],
  Receive: ['qr-code', 'qr-code-outline'],
  History: ['receipt', 'receipt-outline'],
  Settings: ['settings', 'settings-outline'],
};

function Tabs() {
  const { pendingCount } = useSync();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.secondary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.accent },
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
        tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.primary },
        tabBarIcon: ({ focused, color, size }) => <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Wallet' }} />
      <Tab.Screen name="Pay" component={PayScreen} />
      <Tab.Screen name="Receive" component={ReceiveScreen} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ tabBarBadge: pendingCount > 0 ? pendingCount : undefined }} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, user, needsPin } = useAuth();
  const [onboardingDone, setOnboardingDone] = React.useState<boolean | null>(null);
  const [onboardingError, setOnboardingError] = React.useState('');

  React.useEffect(() => {
    let active = true;
    SecureStore.getItemAsync('paybow_onboarding_complete')
      .then((value) => {
        if (active) setOnboardingDone(value === 'true');
      })
      .catch((error: unknown) => {
        if (active) {
          setOnboardingError(error instanceof Error ? error.message : 'Could not read onboarding preference.');
          setOnboardingDone(false);
        }
      });
    return () => { active = false; };
  }, []);

  const completeOnboarding = async () => {
    await SecureStore.setItemAsync('paybow_onboarding_complete', 'true');
    setOnboardingDone(true);
    setOnboardingError('');
  };

  if (!ready || (!user && onboardingDone === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!user && onboardingDone === false) {
    return <OnboardingScreen onComplete={completeOnboarding} storageError={onboardingError} />;
  }
  if (!user || needsPin) return <AuthScreen />;
  return (
    <SyncProvider>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: colors.background, headerTitleStyle: { fontWeight: '700' } }}>
        <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Fund" component={FundScreen} options={{ title: 'Add money' }} />
        <Stack.Screen name="TxDetail" component={TxDetailScreen} options={{ title: 'Transaction' }} />
      </Stack.Navigator>
    </SyncProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
