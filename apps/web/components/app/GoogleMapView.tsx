'use client';
/**
 * Google Maps JS variant of the Explore map, used when NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY is set
 * (Google Places content must be displayed on a Google map). Same props as MapView.
 * The key must be an HTTP-referrer-restricted browser key.
 */
import { useEffect, useRef, useState } from 'react';
import { config } from '@/lib/config';
import type { MapViewProps } from './MapView';

/* Minimal structural typing for the parts of google.maps we use (no @types dependency). */
type LL = { lat: number; lng: number };
interface GMap {
  setCenter(c: LL): void;
  setZoom(z: number): void;
  panTo(c: LL): void;
  fitBounds(b: unknown, pad?: unknown): void;
  setOptions(o: Record<string, unknown>): void;
}
interface GOverlay {
  setMap(m: GMap | null): void;
  setPosition?(p: LL): void;
  setPath?(p: LL[]): void;
  setOptions?(o: Record<string, unknown>): void;
  addListener?(ev: string, cb: (e: { latLng: { lat(): number; lng(): number } }) => void): void;
}
interface GNS {
  maps: {
    Map: new (el: HTMLElement, o: Record<string, unknown>) => GMap;
    Marker: new (o: Record<string, unknown>) => GOverlay;
    Polyline: new (o: Record<string, unknown>) => GOverlay;
    Circle: new (o: Record<string, unknown>) => GOverlay;
    LatLngBounds: new () => { extend(p: LL): void };
    SymbolPath: { FORWARD_CLOSED_ARROW: number; CIRCLE: number };
  };
}

let loader: Promise<GNS> | null = null;
function loadGoogle(key: string): Promise<GNS> {
  loader ??= new Promise((resolve, reject) => {
    const w = window as unknown as { google?: GNS; __telveyGmapsReady?: () => void };
    if (w.google?.maps) return resolve(w.google);
    w.__telveyGmapsReady = () => resolve(w.google!);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__telveyGmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return loader;
}

const DARK_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#11181C' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B8C4C9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#06090B' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1B252B' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#082A31' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];
const LIGHT_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#F7F4EE' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E2DBCF' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DCECEE' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

export default function GoogleMapView(p: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const g = useRef<GNS | null>(null);
  const map = useRef<GMap | null>(null);
  const puck = useRef<GOverlay | null>(null);
  const route = useRef<GOverlay | null>(null);
  const focus = useRef<GOverlay | null>(null);
  const overlays = useRef<GOverlay[]>([]);
  const props = useRef(p);
  props.current = p;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.googleMapsKey) return;
    loadGoogle(config.googleMapsKey)
      .then((ns) => {
        if (!box.current) return;
        g.current = ns;
        const c = props.current.puck ?? { lat: 40.7128, lng: -74.006 };
        map.current = new ns.maps.Map(box.current, { center: c, zoom: props.current.zoom, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', styles: props.current.theme === 'light' ? LIGHT_STYLES : DARK_STYLES });
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (ready) map.current?.setOptions({ styles: p.theme === 'light' ? LIGHT_STYLES : DARK_STYLES });
  }, [p.theme, ready]);

  useEffect(() => {
    const ns = g.current;
    const m = map.current;
    if (!ns || !m || !ready) return;
    route.current?.setMap(null);
    if (p.route && p.route.length > 1) route.current = new ns.maps.Polyline({ map: m, path: p.route, strokeColor: p.theme === 'drive' ? '#FFC857' : '#0F4C5C', strokeOpacity: 0.3, strokeWeight: 10 });
  }, [p.route, ready, p.theme]);

  useEffect(() => {
    const ns = g.current;
    const m = map.current;
    if (!ns || !m || !ready) return;
    focus.current?.setMap(null);
    for (const o of overlays.current) o.setMap(null);
    overlays.current = [];
    if (p.focus) focus.current = new ns.maps.Marker({ map: m, position: p.focus.location, title: p.focus.name, icon: { path: ns.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#FF6A4D', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
    for (const a of p.ahead.slice(0, 3))
      overlays.current.push(new ns.maps.Marker({ map: m, position: { lat: a.lat, lng: a.lng }, title: a.name, icon: { path: ns.maps.SymbolPath.CIRCLE, scale: 6, fillOpacity: 0, strokeColor: '#0F4C5C', strokeWeight: 2.5 } }));
    for (const r of p.results ?? []) overlays.current.push(new ns.maps.Marker({ map: m, position: r.location, title: r.name, label: { text: r.name, fontSize: '12px' } }));
  }, [p.focus, p.ahead, p.results, ready]);

  useEffect(() => {
    const ns = g.current;
    const m = map.current;
    if (!ns || !m || !ready || !p.puck) return;
    const icon = { path: ns.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: p.puck.headingDeg ?? 0, fillColor: p.theme === 'drive' ? '#F4F7F8' : '#0F4C5C', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    if (!puck.current) {
      puck.current = new ns.maps.Marker({ map: m, position: p.puck, icon, draggable: p.draggable, zIndex: 10 });
      puck.current.addListener?.('drag', (e) => props.current.onDrag?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
    } else {
      puck.current.setPosition?.(p.puck);
      puck.current.setOptions?.({ icon, draggable: p.draggable });
    }
    if (!p.focus && !p.draggable) {
      m.panTo(p.puck);
      m.setZoom(p.zoom);
    }
  }, [p.puck, p.zoom, p.draggable, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mapview">
      <div ref={box} className="mapview-canvas" data-testid="map" />
      {error ? <p className="map-tile-note t-caption">{error}</p> : null}
    </div>
  );
}
