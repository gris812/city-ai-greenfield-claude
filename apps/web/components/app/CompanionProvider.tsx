'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { companionStore, type CompanionStore, type Snapshot } from '@/lib/companion/store';
import { DICTS, type Dict } from '@/lib/i18n';

const Ctx = createContext<CompanionStore | null>(null);

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => companionStore());
  useEffect(() => {
    void store.init();
    // PWA: service worker for the app shell + cached audio (scope /app).
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/app' }).catch(() => undefined);
    }
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useCompanion(): [Snapshot, CompanionStore, Dict] {
  const store = useContext(Ctx);
  if (!store) throw new Error('useCompanion outside CompanionProvider');
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [snap, store, DICTS[snap.settings.locale] ?? DICTS.en];
}

/** Resolved colour theme for the app shell (drive wins while driving — D-008). */
export function useAppTheme(snap: Snapshot): 'light' | 'dark' | 'drive' {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setPrefersDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (snap.driveSafe) return 'drive';
  const t = snap.settings.theme;
  return t === 'dark' || (t === 'system' && prefersDark) ? 'dark' : 'light';
}
