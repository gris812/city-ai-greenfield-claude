/**
 * LocationTracker — the phone as a sensor (D-002). Foreground: watchPositionAsync at 1 Hz while
 * moving (relaxed when still, re-subscribed when the sampling class changes). Background (only
 * while a session is active and the user allowed it): startLocationUpdatesAsync with an Android
 * foreground-service notification and iOS navigation activity type. Fixes go to the fix bus;
 * the FrameBatcher de-duplicates overlap between the two producers.
 */
import type { GeoFix } from '@city/core';
import { locationSampling } from '@city/client';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { toGeoFix } from '../logic/location';
import { LOCATION_TASK } from './background-task';
import { publishFixes } from './fix-bus';

export type PermissionState = 'unknown' | 'granted' | 'denied' | 'undetermined';

export interface LocationPermissions {
  foreground: PermissionState;
  background: PermissionState;
  servicesEnabled: boolean;
}

function st(s: Location.PermissionStatus | string): PermissionState {
  return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'undetermined';
}

export class LocationTracker {
  private sub: Location.LocationSubscription | null = null;
  private headingSub: Location.LocationSubscription | null = null;
  private samplingKey = '';
  private lastSpeed = 0;
  private driving = false;
  private bgStarted = false;
  compassDeg: number | null = null;
  onHeading: ((deg: number) => void) | null = null;

  async permissions(): Promise<LocationPermissions> {
    try {
      const [fg, bg, services] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
      return { foreground: st(fg.status), background: st(bg.status), servicesEnabled: services };
    } catch {
      return { foreground: 'unknown', background: 'unknown', servicesEnabled: false };
    }
  }

  async requestForeground(): Promise<PermissionState> {
    try {
      return st((await Location.requestForegroundPermissionsAsync()).status);
    } catch {
      return 'denied';
    }
  }

  /** Must be asked after foreground was granted (Android 11+ sends the user to Settings). */
  async requestBackground(): Promise<PermissionState> {
    try {
      return st((await Location.requestBackgroundPermissionsAsync()).status);
    } catch {
      return 'denied';
    }
  }

  /** Hint from the server's regime (driving → always 1 Hz, best accuracy). */
  setDriving(driving: boolean): void {
    if (this.driving === driving) return;
    this.driving = driving;
    void this.resubscribeIfNeeded();
  }

  async startForeground(): Promise<boolean> {
    const perm = await this.permissions();
    if (perm.foreground !== 'granted') return false;
    await this.resubscribeIfNeeded(true);
    if (!this.headingSub) {
      try {
        this.headingSub = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (Number.isFinite(deg) && deg >= 0) {
            this.compassDeg = deg;
            this.onHeading?.(deg);
          }
        });
      } catch {
        /* no magnetometer */
      }
    }
    return true;
  }

  private async resubscribeIfNeeded(force = false): Promise<void> {
    const s = locationSampling(this.lastSpeed, this.driving);
    const key = `${s.timeIntervalMs}/${s.distanceIntervalM}/${this.driving}`;
    if (!force && (key === this.samplingKey || !this.sub)) return;
    this.samplingKey = key;
    this.sub?.remove();
    this.sub = null;
    try {
      this.sub = await Location.watchPositionAsync(
        {
          accuracy: this.driving ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
          timeInterval: s.timeIntervalMs,
          distanceInterval: s.distanceIntervalM,
          mayShowUserSettingsDialog: true,
        },
        (loc) => {
          const f = toGeoFix(loc);
          if (!f) return;
          const prevClass = this.lastSpeed >= 0.8;
          this.lastSpeed = f.speedMps ?? this.lastSpeed;
          publishFixes([f], 'foreground');
          if (prevClass !== this.lastSpeed >= 0.8) void this.resubscribeIfNeeded();
        },
        () => undefined,
      );
    } catch {
      this.sub = null;
    }
  }

  async startBackground(labels: { title: string; body: string }): Promise<boolean> {
    const perm = await this.permissions();
    if (perm.background !== 'granted') return false;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        this.bgStarted = true;
        return true;
      }
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
        // Batch while locked: the OS may deliver several fixes at once; the batcher sends them together.
        deferredUpdatesInterval: 1000,
        activityType: Location.LocationActivityType.OtherNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: labels.title,
          notificationBody: labels.body,
          notificationColor: '#0F4C5C',
          killServiceOnDestroy: true,
        },
      });
      this.bgStarted = true;
      return true;
    } catch {
      return false;
    }
  }

  async stopBackground(): Promise<void> {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch {
      /* not started */
    }
    this.bgStarted = false;
  }

  get backgroundActive(): boolean {
    return this.bgStarted;
  }

  stopForeground(): void {
    this.sub?.remove();
    this.sub = null;
    this.headingSub?.remove();
    this.headingSub = null;
    this.samplingKey = '';
  }

  async stopAll(): Promise<void> {
    this.stopForeground();
    await this.stopBackground();
  }

  static get platformNote(): string {
    return Platform.OS === 'android' ? 'foreground-service' : 'ios-background-location';
  }
}

export type { GeoFix };
