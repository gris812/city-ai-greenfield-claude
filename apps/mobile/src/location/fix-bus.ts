/**
 * In-process bus between location producers (foreground watcher, background task) and the
 * companion store. Module-level on purpose: the background task is defined at module scope
 * (index.ts) and may fire before any React tree exists; fixes are buffered until a consumer
 * subscribes. If the OS relaunches the JS runtime headless (no active session UI), buffered
 * fixes simply expire — they are never persisted (D-012).
 */
import type { GeoFix } from '@city/core';
import { FixBuffer } from '../logic/location';

type Listener = (fixes: GeoFix[], origin: 'foreground' | 'background') => void;

const listeners = new Set<Listener>();
const pending = new FixBuffer(300);

export function publishFixes(fixes: GeoFix[], origin: 'foreground' | 'background'): void {
  if (fixes.length === 0) return;
  if (listeners.size === 0) {
    pending.push(fixes);
    return;
  }
  for (const l of listeners) l(fixes, origin);
}

export function subscribeFixes(l: Listener): () => void {
  listeners.add(l);
  const backlog = pending.drain();
  if (backlog.length) l(backlog, 'background');
  return () => listeners.delete(l);
}
