import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';
import { adminStore, type AdminSnapshot } from '../admin/store';
import { MDICTS, type MDict } from '../i18n';
import { PALETTES, type Theme } from '../theme/theme';
import { companionStore, type Snapshot } from './companion';

export function useCompanion(): Snapshot {
  const s = companionStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}

export function useAdmin(): AdminSnapshot {
  const s = adminStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}

export function useT(): MDict {
  const snap = useCompanion();
  return MDICTS[snap.settings.locale];
}

/** Drive palette whenever the server says drive-safe (E1); otherwise follow the OS scheme. */
export function useAppTheme(): Theme {
  const scheme = useColorScheme();
  const snap = useCompanion();
  const name = snap.view.driveSafe ? 'drive' : scheme === 'dark' ? 'dark' : 'light';
  return { name, c: PALETTES[name] };
}
