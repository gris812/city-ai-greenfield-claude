// Per-weight entry points so only the weights we use are bundled.
import { Literata_400Regular } from '@expo-google-fonts/literata/400Regular';
import { Literata_400Regular_Italic } from '@expo-google-fonts/literata/400Regular_Italic';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Onest_700Bold } from '@expo-google-fonts/onest/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { adminStore } from '../src/admin/store';
import { companionStore } from '../src/store/companion';
import { useAppTheme, useCompanion } from '../src/store/hooks';
import { ThemeContext } from '../src/theme/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Fonts are bundled with the app (npm @expo-google-fonts/*), never fetched from the network.
  const [fontsLoaded, fontError] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, Literata_400Regular, Literata_400Regular_Italic });
  const snap = useCompanion();
  const theme = useAppTheme();

  useEffect(() => {
    void companionStore().init();
    void adminStore().load();
  }, []);

  const ready = (fontsLoaded || !!fontError) && snap.ready;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.c.bg).catch(() => undefined);
  }, [theme.c.bg]);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>
        <StatusBar style={theme.name === 'light' ? 'dark' : 'light'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.c.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="simulation" options={{ presentation: 'modal' }} />
          <Stack.Screen name="admin" />
          <Stack.Screen name="pair" />
        </Stack>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
