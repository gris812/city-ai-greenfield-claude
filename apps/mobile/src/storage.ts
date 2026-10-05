/**
 * Device storage. Secrets (guest JWT, admin device token) go to the OS keystore via
 * expo-secure-store; conveniences (settings, local history, onboarding flag) go to AsyncStorage.
 * Every access is wrapped: storage can fail (keystore locked before first unlock, full disk) and
 * the app must keep working with in-memory state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const KEYS = {
  guest: 'telvey.guest.v1',
  admin: 'telvey.admin.v1',
  settings: 'telvey.settings.v1',
  history: 'telvey.history.v1',
  onboarded: 'telvey.onboarded.v1',
} as const;

export const secure = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await SecureStore.getItemAsync(key, SECURE_OPTS);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, v: unknown): Promise<void> {
    try {
      if (v === null || v === undefined) await SecureStore.deleteItemAsync(key, SECURE_OPTS);
      else await SecureStore.setItemAsync(key, JSON.stringify(v), SECURE_OPTS);
    } catch {
      /* keystore unavailable — token stays in memory for this run */
    }
  },
};

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, v: unknown): Promise<void> {
    try {
      if (v === null || v === undefined) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
  async clearTelvey(): Promise<void> {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('telvey.'));
      await AsyncStorage.multiRemove(keys);
    } catch {
      /* ignore */
    }
  },
};

/** Guest identity (D-012: no PII; deletable any time). */
export const guestStore = {
  get: () => secure.get<{ guestId: string; token: string }>(KEYS.guest),
  set: (v: { guestId: string; token: string } | null) => secure.set(KEYS.guest, v),
};
