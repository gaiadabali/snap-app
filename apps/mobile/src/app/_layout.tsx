import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, usePalette, useTheme } from '@/theme';
import { SessionGate } from '@/session';
import { WorkspaceProvider } from '@/workspace';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootChrome />
    </ThemeProvider>
  );
}

/** Split out so it can read the theme the provider above supplies. */
function RootChrome() {
  const p = usePalette();
  const { scheme } = useTheme();

  /**
   * Paint the ground explicitly.
   *
   * Screens set their own background, but the surface *behind* the navigator is
   * unpainted by default — transparent, which resolves to white. In dark mode
   * that put light ink on a white masthead and made the client's name almost
   * invisible. A screen's background is not enough; the root has to be painted
   * too, on every platform the demo might run on.
   */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(p.ground).catch(() => {
      /* not supported on this platform */
    });
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = p.ground;
      document.body.style.backgroundColor = p.ground;
      // Makes scrollbars and form controls follow the theme too.
      document.documentElement.style.colorScheme = scheme === 'dark' ? 'dark' : 'light';
    }
  }, [p.ground, scheme]);

  return (
    <SafeAreaProvider style={{ backgroundColor: p.ground }}>
      <SessionGate>
        <WorkspaceProvider>
      <View style={{ flex: 1, backgroundColor: p.ground }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: p.ground },
            headerTintColor: p.ink,
            /* The redesign's screen title: 24/30 bold, hard left, no centre
               alignment and no shadow. Set once here so every pushed screen
               that still uses the navigator's header matches the ones that
               draw their own `<ScreenHeader>`. */
            headerTitleAlign: 'left',
            headerTitleStyle: { fontSize: 24, fontWeight: '700', color: p.ink },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerLeft: undefined,
            contentStyle: { backgroundColor: p.ground },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="receipts" options={{ headerShown: false }} />
          <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
          <Stack.Screen name="members" options={{ title: 'People' }} />
          <Stack.Screen
            name="join"
            options={{ title: 'Invitation', presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="bills" options={{ title: 'Bills' }} />
          <Stack.Screen name="payments" options={{ title: 'Payments' }} />
          <Stack.Screen name="mileage" options={{ title: 'Mileage' }} />
          <Stack.Screen name="stocktake" options={{ title: 'Stock take' }} />
          <Stack.Screen name="taxpack" options={{ title: 'Tax pack' }} />
          <Stack.Screen name="connections" options={{ title: 'Connections' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="categories" options={{ title: 'Categories' }} />
          <Stack.Screen name="plan" options={{ title: 'Plan' }} />
          <Stack.Screen name="recurring" options={{ title: 'Recurring' }} />
          <Stack.Screen name="goals" options={{ title: 'Goals' }} />
          <Stack.Screen name="document/[id]" options={{ title: 'Review' }} />
          <Stack.Screen name="tax" options={{ title: 'Tax & BAS' }} />
          <Stack.Screen name="invoices" options={{ title: 'Invoices' }} />
          <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
          <Stack.Screen name="invoice/new" options={{ title: 'New invoice', presentation: 'modal' }} />
          <Stack.Screen name="items" options={{ title: 'Items' }} />
          <Stack.Screen name="parties" options={{ title: 'Contacts' }} />
          <Stack.Screen name="reports" options={{ title: 'Reports' }} />

          {/* The 2026-09-19 redesign. These draw their own back arrow and
              title with `<ScreenHeader>`, the way the prototype does, so the
              navigator's header is off for all of them. */}
          <Stack.Screen name="credits" options={{ headerShown: false }} />
          <Stack.Screen name="wallet/add" options={{ headerShown: false }} />
          <Stack.Screen name="wallet/card" options={{ headerShown: false }} />
          <Stack.Screen name="orders" options={{ headerShown: false }} />
          <Stack.Screen name="order/[id]" options={{ headerShown: false }} />
          <Stack.Screen
            name="pay"
            options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
          />
          <Stack.Screen name="usage" options={{ headerShown: false }} />
          <Stack.Screen name="rewards" options={{ headerShown: false }} />
          <Stack.Screen name="alerts" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="fingerprint" options={{ headerShown: false }} />
          <Stack.Screen name="help" options={{ headerShown: false }} />
          <Stack.Screen name="export" options={{ headerShown: false }} />
          <Stack.Screen name="goal/[id]" options={{ headerShown: false }} />
        </Stack>
          </View>
        </WorkspaceProvider>
      </SessionGate>
    </SafeAreaProvider>
  );
}
