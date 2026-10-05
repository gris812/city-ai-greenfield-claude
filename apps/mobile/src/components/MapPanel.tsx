/**
 * Explore map: user puck with heading, focused place (ember), nearby results, route band.
 * Provider: Google on Android (requires EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY at build time), Apple
 * Maps on iOS (Google when an iOS key is configured). Without an Android key the Google SDK would
 * render a blank grey map, so a clearly labelled schematic view is shown instead.
 * In drive mode the map is glanceable only: no results, no gestures that need attention.
 */
import type { LatLng } from '@city/core';
import type { CompanionView } from '@city/client';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { config } from '../config';
import { radius, space, useTheme } from '../theme/theme';
import { Icon, T } from './ui';

export interface MapPanelProps {
  position: (LatLng & { headingDeg: number | null }) | null;
  view: CompanionView;
  trail: LatLng[];
  drive: boolean;
  onPressMap?: (p: LatLng) => void;
  label: string;
}

/** Ionicons "navigate" points north-east; subtract to make 0° point north. */
const NAV_ICON_OFFSET = 45;

function regionFor(center: LatLng, drive: boolean): Region {
  const d = drive ? 0.05 : 0.008;
  return { latitude: center.lat, longitude: center.lng, latitudeDelta: d, longitudeDelta: d };
}

export function MapPanel(props: MapPanelProps) {
  if (config.mapsProvider === 'none') return <SchematicMap {...props} />;
  return <NativeMap {...props} />;
}

function NativeMap({ position, view, trail, drive, onPressMap, label }: MapPanelProps) {
  const { c, name } = useTheme();
  const ref = useRef<MapView>(null);
  const focus = view.focus;
  const results = drive ? null : view.results;
  const lastCenter = useRef<string>('');

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    if (results && results.length > 0 && position) {
      m.fitToCoordinates([{ latitude: position.lat, longitude: position.lng }, ...results.map((r) => ({ latitude: r.location.lat, longitude: r.location.lng }))], {
        edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
        animated: true,
      });
      return;
    }
    const center = position;
    if (!center) return;
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${drive}`;
    if (key === lastCenter.current) return;
    lastCenter.current = key;
    m.animateToRegion(regionFor(center, drive), drive ? 140 : 400);
  }, [position, results, drive]);

  const trailCoords = useMemo(() => trail.map((p) => ({ latitude: p.lat, longitude: p.lng })), [trail]);

  return (
    <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={label}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={config.mapsProvider === 'google' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={position ? regionFor(position, drive) : { latitude: 39.5, longitude: -98.35, latitudeDelta: 30, longitudeDelta: 30 }}
        userInterfaceStyle={name === 'light' ? 'light' : 'dark'}
        showsUserLocation={false}
        showsCompass={!drive}
        showsPointsOfInterests={!drive}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={!drive}
        onPress={(e) => onPressMap?.({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
      >
        {trailCoords.length > 1 ? <Polyline coordinates={trailCoords} strokeColor={c.route} strokeWidth={drive ? 8 : 5} lineCap="round" lineJoin="round" /> : null}
        {results?.map((r) => (
          <Marker key={r.placeId} coordinate={{ latitude: r.location.lat, longitude: r.location.lng }} title={r.name} pinColor={c.brand} tracksViewChanges={false} />
        ))}
        {focus ? (
          <Marker key={`f-${focus.placeId}`} coordinate={{ latitude: focus.location.lat, longitude: focus.location.lng }} title={focus.name} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[styles.focus, { backgroundColor: c.poiAhead, borderColor: c.surface }]} />
          </Marker>
        ) : null}
        {position ? (
          <Marker coordinate={{ latitude: position.lat, longitude: position.lng }} anchor={{ x: 0.5, y: 0.5 }} flat rotation={position.headingDeg !== null ? position.headingDeg - NAV_ICON_OFFSET : 0} tracksViewChanges={false}>
            <Puck heading={position.headingDeg} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

function Puck({ heading }: { heading: number | null }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      {heading !== null ? <Icon name="navigate" size={30} color={c.brand} /> : <View style={[styles.dot, { backgroundColor: c.brand, borderColor: c.surface }]} />}
    </View>
  );
}

/** Keyless fallback: relative positions around the user (north-up), clearly labelled. */
function SchematicMap({ position, view, drive, label }: MapPanelProps) {
  const { c } = useTheme();
  const pts = useMemo(() => {
    if (!position) return [];
    const items: Array<{ id: string; name: string; p: LatLng; focus: boolean }> = [];
    if (view.focus) items.push({ id: view.focus.placeId, name: view.focus.name, p: view.focus.location, focus: true });
    if (!drive) for (const r of view.results ?? []) items.push({ id: r.placeId, name: r.name, p: r.location, focus: false });
    const scaleM = drive ? 6000 : 1200;
    return items.map((it) => {
      const dy = (it.p.lat - position.lat) * 111_320;
      const dx = (it.p.lng - position.lng) * 111_320 * Math.cos((position.lat * Math.PI) / 180);
      const k = Math.min(1, Math.hypot(dx, dy) / scaleM);
      const ang = Math.atan2(dx, dy);
      return { ...it, x: Math.sin(ang) * k, y: -Math.cos(ang) * k };
    });
  }, [position, view.focus, view.results, drive]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }]} accessible accessibilityLabel={`${label}. Schematic view: map provider not configured.`}>
      <View style={[styles.ring, { borderColor: c.line, width: 260, height: 260, borderRadius: 130 }]} />
      <View style={[styles.ring, { borderColor: c.line, width: 140, height: 140, borderRadius: 70 }]} />
      {position ? (
        <View style={{ position: 'absolute', transform: [{ rotate: `${position.headingDeg !== null ? position.headingDeg - NAV_ICON_OFFSET : 0}deg` }] }}>
          <Icon name={position.headingDeg !== null ? 'navigate' : 'ellipse'} size={28} color={c.brand} />
        </View>
      ) : null}
      {pts.map((p) => (
        <View key={p.id} style={{ position: 'absolute', transform: [{ translateX: p.x * 130 }, { translateY: p.y * 130 }], alignItems: 'center' }}>
          <View style={[styles.focus, { backgroundColor: p.focus ? c.poiAhead : c.brand, borderColor: c.surface }]} />
          {!drive ? (
            <T v="caption" color={c.text2} numberOfLines={1} style={{ maxWidth: 120 }}>
              {p.name}
            </T>
          ) : null}
        </View>
      ))}
      <View style={[styles.schematicTag, { backgroundColor: c.surface }]}>
        <T v="caption" color={c.text3}>
          Schematic · north up · map key not configured
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  focus: { width: 20, height: 20, borderRadius: 10, borderWidth: 3 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  ring: { position: 'absolute', borderWidth: 1 },
  schematicTag: { position: 'absolute', bottom: space['2'], alignSelf: 'center', paddingHorizontal: space['2'], paddingVertical: 2, borderRadius: radius.sm },
});
