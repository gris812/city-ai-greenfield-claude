import { Redirect } from 'expo-router';
import { useCompanion } from '../src/store/hooks';

export default function Index() {
  const snap = useCompanion();
  return <Redirect href={snap.onboarded ? '/(tabs)' : '/onboarding'} />;
}
