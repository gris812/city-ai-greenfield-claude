/**
 * Background location task (E2). Registered at module scope from index.ts so the OS can deliver
 * batches while the screen is locked. Started only while a companion session is active
 * (LocationTracker.startBackground) and stopped when it ends:
 *  - Android: runs as a foreground service with a persistent notification (required by the OS;
 *    FOREGROUND_SERVICE_LOCATION), which also keeps the process — and therefore audio — alive.
 *  - iOS: UIBackgroundModes location + audio; the blue location pill is shown.
 */
import * as TaskManager from 'expo-task-manager';
import type { GeoFix } from '@city/core';
import { toGeoFix, type OsLocation } from '../logic/location';
import { publishFixes } from './fix-bus';

export const LOCATION_TASK = 'telvey.session.location';

TaskManager.defineTask<{ locations?: OsLocation[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  const fixes = data.locations.map(toGeoFix).filter((f): f is GeoFix => f !== null);
  publishFixes(fixes, 'background');
});
