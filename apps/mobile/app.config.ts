/**
 * Expo app config (dynamic). No secrets: everything here ends up in the app binary or the JS
 * bundle. Values come from the environment (EAS profile `env` in eas.json, or a local .env):
 *
 *   APP_VARIANT                     development | preview | production (name/id suffix for side-by-side installs)
 *   APP_BUNDLE_ID                   iOS bundle identifier       (default com.telvey.app)
 *   APP_ANDROID_PACKAGE             Android application id      (default com.telvey.app)
 *   EXPO_PUBLIC_API_BASE_URL        Telvey API base URL (unset → offline demo mode only)
 *   EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY  Maps SDK for Android key — RESTRICT to package + SHA-1
 *   EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY      Maps SDK for iOS key — RESTRICT to bundle id (optional;
 *                                        iOS uses Apple Maps when unset)
 *   EAS_PROJECT_ID / EXPO_OWNER     written by `eas init` instructions in docs/MOBILE.md
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';
import pkg from './package.json';

const variant = (process.env.APP_VARIANT ?? 'production') as 'development' | 'preview' | 'production';
const suffix = variant === 'production' ? '' : `.${variant === 'development' ? 'dev' : 'preview'}`;
const nameSuffix = variant === 'production' ? '' : variant === 'development' ? ' (Dev)' : ' (Preview)';

const iosBundleId = (process.env.APP_BUNDLE_ID ?? 'com.telvey.app') + suffix;
const androidPackage = (process.env.APP_ANDROID_PACKAGE ?? 'com.telvey.app') + suffix;
const mapsAndroidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim() || undefined;
const mapsIosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?.trim() || undefined;

const LOCATION_WHEN_IN_USE =
  'Telvey uses your location to tell you about places around you and ahead of you. Precise location stays on your device and in the active session only.';
const LOCATION_ALWAYS =
  'While a Telvey session is running and your screen is locked (for example while driving), Telvey keeps using your location so stories stay in step with the road. It stops when you end the session.';
const MICROPHONE = 'Telvey listens only while you hold or tap the microphone, so you can ask about what you see.';
const SPEECH = 'Telvey turns what you say into text on your device so it can answer your question quickly.';
const CAMERA = 'The camera is used only to scan an operator pairing code in Settings → Operator access.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Telvey${nameSuffix}`,
  slug: 'telvey',
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  version: pkg.version,
  scheme: 'telvey',
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/icon.png',
  backgroundColor: '#F7F4EE',
  ios: {
    bundleIdentifier: iosBundleId,
    supportsTablet: false,
    ...(mapsIosKey ? { config: { googleMapsApiKey: mapsIosKey } } : {}),
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
      NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
      NSMicrophoneUsageDescription: MICROPHONE,
      NSSpeechRecognitionUsageDescription: SPEECH,
      NSCameraUsageDescription: CAMERA,
      UIBackgroundModes: ['audio', 'location'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: androidPackage,
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-foreground.png',
      backgroundImage: './assets/brand/adaptive-background.png',
      monochromeImage: './assets/brand/adaptive-monochrome.png',
      backgroundColor: '#0F4C5C',
    },
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.CAMERA',
    ],
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    'expo-localization',
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash-mark.png',
        imageWidth: 120,
        resizeMode: 'contain',
        backgroundColor: '#F7F4EE',
        dark: { image: './assets/brand/splash-mark-dark.png', backgroundColor: '#082A31' },
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
        locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
        locationAlwaysPermission: LOCATION_ALWAYS,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/brand/notification-icon.png',
      },
    ],
    ['expo-audio', { microphonePermission: MICROPHONE, recordAudioAndroid: true, enableBackgroundPlayback: true, enableBackgroundRecording: false }],
    ['expo-speech-recognition', { microphonePermission: MICROPHONE, speechRecognitionPermission: SPEECH }],
    ['expo-camera', { cameraPermission: CAMERA, microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: true }],
    ['react-native-maps', { ...(mapsAndroidKey ? { androidGoogleMapsApiKey: mapsAndroidKey } : {}), ...(mapsIosKey ? { iosGoogleMapsApiKey: mapsIosKey } : {}) }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    variant,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    mapsProviderAndroid: mapsAndroidKey ? 'google' : 'none',
    mapsProviderIos: mapsIosKey ? 'google' : 'apple',
    router: {},
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
