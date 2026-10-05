import { Stack } from 'expo-router/stack';
import { useTheme } from '../../src/theme/theme';

export default function AdminLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />;
}
