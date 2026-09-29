import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useCompanion, useT } from '../../src/store/hooks';
import { FONT, useTheme } from '../../src/theme/theme';

export default function TabsLayout() {
  const t = useT();
  const snap = useCompanion();
  const { c } = useTheme();
  const drive = snap.view.driveSafe;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.text3,
        tabBarLabelStyle: { fontFamily: FONT.sans[500], fontSize: 12 },
        // D-008 / E1: no navigation chrome while driving — the drive HUD is the whole screen.
        tabBarStyle: drive ? { display: 'none' } : { backgroundColor: c.surface, borderTopColor: c.line, minHeight: 56 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.explore, tabBarAccessibilityLabel: t.explore, tabBarIcon: ({ color, size }) => <Ionicons name="compass" color={color} size={size} /> }} />
      <Tabs.Screen name="history" options={{ title: t.history, tabBarAccessibilityLabel: t.history, tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: t.settings, tabBarAccessibilityLabel: t.settings, tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} /> }} />
    </Tabs>
  );
}
