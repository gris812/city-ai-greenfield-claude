/**
 * Public runtime configuration. Only EXPO_PUBLIC_* values are inlined into the JS bundle, and
 * they must never hold secrets. Maps keys live in the native config (app.config.ts) and must be
 * restricted to the app's package/bundle id in Google Cloud.
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiBaseFromEnv } from './logic/config';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

// NB: must be written literally as process.env.EXPO_PUBLIC_… so Metro inlines it at build time.
const envBase = process.env.EXPO_PUBLIC_API_BASE_URL;
const api = apiBaseFromEnv(envBase ?? (typeof extra.apiBaseUrl === 'string' ? extra.apiBaseUrl : null));

export const config = {
  /** Telvey API base URL; null → offline demo mode only. */
  apiBaseUrl: api.baseUrl,
  /** The build carries a placeholder API URL (eas.json not yet edited). */
  apiPlaceholder: api.placeholder,
  mapsProvider: (Platform.OS === 'android' ? (extra.mapsProviderAndroid === 'google' ? 'google' : 'none') : extra.mapsProviderIos === 'google' ? 'google' : 'apple') as 'google' | 'apple' | 'none',
  appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0',
  buildNumber: Application.nativeBuildVersion ?? 'dev',
  variant: (typeof extra.variant === 'string' ? extra.variant : 'development') as 'development' | 'preview' | 'production',
  platform: Platform.OS,
} as const;

export const BRAND = {
  name: 'Telvey',
  tagline: 'A local companion for wherever you are.',
  promise: 'Knows when to talk, and when to stay quiet.',
} as const;
