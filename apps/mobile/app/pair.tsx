/** Deep link telvey://pair?code=…&api=… (the web console's pairing QR) → operator pairing screen. */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function PairLink() {
  const p = useLocalSearchParams<{ code?: string; api?: string }>();
  return <Redirect href={{ pathname: '/admin/pair', params: { ...(p.code ? { code: p.code } : {}), ...(p.api ? { api: p.api } : {}) } }} />;
}
