'use client';
/**
 * Explore map (MapLibre GL). Base: a muted OSM raster (or NEXT_PUBLIC_MAP_STYLE_URL); overlay
 * follows BRAND §2: only the place being told (ember dot + halo), up to 3 "ahead" candidates
 * (hollow petrol rings), the route/trajectory as a translucent band, and the user as a petrol
 * arrow in a soft heading cone. Drive/dark themes invert the base to near-black.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import type { LatLng } from '@city/core';
import { config } from '@/lib/config';

export type MapTheme = 'light' | 'dark' | 'drive';

export interface MapViewProps {
  theme: MapTheme;
  puck: (LatLng & { headingDeg: number | null }) | null;
  route: LatLng[] | null;
  focus: { name: string; location: LatLng } | null;
  ahead: Array<{ id: string; name: string; lat: number; lng: number }>;
  results: Array<{ placeId: string; name: string; location: LatLng }> | null;
  zoom: number;
  draggable: boolean;
  onDrag?: (p: LatLng) => void;
  /** Padding (px) for UI covering the map (sheet, panels). */
  pad: { top: number; bottom: number; left: number; right: number };
}

const PALETTE = {
  light: { bg: '#F7F4EE', route: '#0F4C5C', routeOpacity: 0.16, ring: '#0F4C5C', focus: '#FF6A4D', puck: '#0F4C5C' },
  dark: { bg: '#082A31', route: '#8DBBC2', routeOpacity: 0.22, ring: '#8DBBC2', focus: '#FF8A70', puck: '#F7F4EE' },
  drive: { bg: '#06090B', route: '#FFC857', routeOpacity: 0.28, ring: '#51626A', focus: '#FF8A70', puck: '#F4F7F8' },
} as const;

function rasterPaint(theme: MapTheme) {
  return theme === 'light'
    ? { 'raster-saturation': -0.85, 'raster-contrast': -0.08, 'raster-brightness-min': 0.12, 'raster-brightness-max': 1, 'raster-opacity': 0.9 }
    : // swap min/max → inverted brightness (dark base); desaturated
      { 'raster-saturation': -1, 'raster-contrast': theme === 'drive' ? 0.1 : 0, 'raster-brightness-min': theme === 'drive' ? 0.55 : 0.62, 'raster-brightness-max': theme === 'drive' ? 0.02 : 0.1, 'raster-opacity': 0.85 };
}

function baseStyle(theme: MapTheme): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PALETTE[theme].bg } },
      { id: 'osm', type: 'raster', source: 'osm', paint: rasterPaint(theme) },
    ],
  };
}

type GeoData = Parameters<GeoJSONSource['setData']>[0];
/** Pad for UI chrome, but never so much that the viewport collapses (small screens). */
function padFor(pad: MapViewProps['pad'], extra: number) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  const clampV = (v: number) => Math.min(v, h * 0.55);
  const clampH = (v: number) => Math.min(v, w * 0.55);
  return { top: clampV(pad.top + extra / 2), bottom: clampV(pad.bottom + extra / 2), left: clampH(pad.left + extra / 2), right: clampH(pad.right + extra / 2) };
}

const EMPTY = { type: 'FeatureCollection', features: [] } as GeoData;

function puckElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'puck';
  el.setAttribute('aria-label', 'Your position');
  el.innerHTML =
    '<svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true"><path class="puck-cone" d="M40 40 L22 4 A40 40 0 0 1 58 4 Z"/><circle class="puck-ring" cx="40" cy="40" r="14"/><path class="puck-arrow" d="M40 29 l-8 19 8-5 8 5z"/></svg>';
  return el;
}

function labelElement(text: string, kind: 'focus' | 'result'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `map-label map-label-${kind}`;
  el.textContent = text;
  return el;
}

export default function MapView(p: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ml = useRef<typeof import('maplibre-gl') | null>(null);
  const puck = useRef<Marker | null>(null);
  const focusLabel = useRef<Marker | null>(null);
  const resultMarkers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const props = useRef(p);
  props.current = p;
  const lastFocus = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((lib) => {
      if (cancelled || !box.current) return;
      ml.current = lib;
      const start = props.current.puck ?? { lat: 40.7128, lng: -74.006 };
      const m = new lib.Map({
        container: box.current,
        style: config.mapStyleUrl ?? baseStyle(props.current.theme),
        center: [start.lng, start.lat],
        zoom: props.current.zoom,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
      m.touchZoomRotate.disableRotation();
      map.current = m;
      (window as unknown as { __telveyMap?: MlMap }).__telveyMap = m; // debug/e2e hook (no data beyond what is on screen)
      m.on('error', (e) => {
        if (String((e as { error?: Error }).error?.message ?? '').match(/tile|fetch|Failed/i)) setTileError(true);
      });
      m.on('load', () => {
        const pal = PALETTE[props.current.theme];
        m.addSource('route', { type: 'geojson', data: EMPTY });
        m.addSource('ahead', { type: 'geojson', data: EMPTY });
        m.addSource('focus', { type: 'geojson', data: EMPTY });
        m.addSource('results', { type: 'geojson', data: EMPTY });
        m.addLayer({ id: 'route-band', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': pal.route, 'line-opacity': pal.routeOpacity, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 16] } });
        m.addLayer({ id: 'route-core', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': pal.route, 'line-opacity': 0.55, 'line-width': 2, 'line-dasharray': [1, 2] } });
        m.addLayer({ id: 'ahead-ring', type: 'circle', source: 'ahead', paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': pal.ring, 'circle-stroke-width': 2.5 } });
        m.addLayer({ id: 'results-dot', type: 'circle', source: 'results', paint: { 'circle-radius': 6, 'circle-color': pal.ring, 'circle-stroke-color': pal.bg, 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'focus-halo', type: 'circle', source: 'focus', paint: { 'circle-radius': 22, 'circle-color': pal.focus, 'circle-opacity': 0.18 } });
        m.addLayer({ id: 'focus-ring', type: 'circle', source: 'focus', paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': pal.focus, 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'focus-dot', type: 'circle', source: 'focus', paint: { 'circle-radius': 7, 'circle-color': pal.focus } });
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // theme
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const pal = PALETTE[p.theme];
    m.setPaintProperty('route-band', 'line-color', pal.route);
    m.setPaintProperty('route-band', 'line-opacity', pal.routeOpacity);
    m.setPaintProperty('route-core', 'line-color', pal.route);
    m.setPaintProperty('ahead-ring', 'circle-stroke-color', pal.ring);
    m.setPaintProperty('results-dot', 'circle-color', pal.ring);
    for (const id of ['focus-halo', 'focus-dot']) m.setPaintProperty(id, 'circle-color', pal.focus);
    m.setPaintProperty('focus-ring', 'circle-stroke-color', pal.focus);
    box.current?.setAttribute('data-map-theme', p.theme);
    if (!config.mapStyleUrl) {
      try {
        m.setPaintProperty('bg', 'background-color', pal.bg);
        for (const [k, v] of Object.entries(rasterPaint(p.theme))) m.setPaintProperty('osm', k, v);
      } catch (e) {
        console.warn('[map] base theme update failed', e);
      }
    }
    m.triggerRepaint();
  }, [p.theme, ready]);

  // No tiles (offline / blocked): let the CSS dot grid show through so the map reads as intentional.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || config.mapStyleUrl) return;
    m.setPaintProperty('bg', 'background-opacity', tileError ? 0 : 1);
  }, [tileError, ready]);

  // route band
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('route') as GeoJSONSource).setData(
      p.route && p.route.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.route.map((x) => [x.lng, x.lat]) } } : EMPTY,
    );
  }, [p.route, ready]);

  // ahead rings
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('ahead') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: p.ahead.slice(0, 3).map((a) => ({ type: 'Feature', properties: { name: a.name }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } })),
    });
  }, [p.ahead, ready]);

  // focus
  useEffect(() => {
    const m = map.current;
    const lib = ml.current;
    if (!m || !lib || !ready) return;
    (m.getSource('focus') as GeoJSONSource).setData(p.focus ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.focus.location.lng, p.focus.location.lat] } } : EMPTY);
    focusLabel.current?.remove();
    focusLabel.current = null;
    if (p.focus && p.theme !== 'drive') {
      focusLabel.current = new lib.Marker({ element: labelElement(p.focus.name, 'focus'), anchor: 'left', offset: [18, 0] }).setLngLat([p.focus.location.lng, p.focus.location.lat]).addTo(m);
    }
    const key = p.focus ? `${p.focus.location.lat},${p.focus.location.lng}` : null;
    if (key && key !== lastFocus.current && p.puck && p.theme !== 'drive') {
      const b = new lib.LngLatBounds([p.puck.lng, p.puck.lat], [p.puck.lng, p.puck.lat]).extend([p.focus!.location.lng, p.focus!.location.lat]);
      m.fitBounds(b, { padding: padFor(p.pad, 60), maxZoom: 17, duration: 900 });
    }
    lastFocus.current = key;
  }, [p.focus, ready, p.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // results
  useEffect(() => {
    const m = map.current;
    const lib = ml.current;
    if (!m || !lib || !ready) return;
    for (const mk of resultMarkers.current) mk.remove();
    resultMarkers.current = [];
    const rs = p.results ?? [];
    (m.getSource('results') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: rs.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [r.location.lng, r.location.lat] } })),
    });
    if (p.theme !== 'drive') for (const r of rs) resultMarkers.current.push(new lib.Marker({ element: labelElement(r.name, 'result'), anchor: 'left', offset: [10, 0] }).setLngLat([r.location.lng, r.location.lat]).addTo(m));
    if (rs.length > 0 && p.puck) {
      const b = new lib.LngLatBounds([p.puck.lng, p.puck.lat], [p.puck.lng, p.puck.lat]);
      for (const r of rs) b.extend([r.location.lng, r.location.lat]);
      m.fitBounds(b, { padding: padFor(p.pad, 50), maxZoom: 17, duration: 700 });
    }
  }, [p.results, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // puck + follow camera
  useEffect(() => {
    const m = map.current;
    const lib = ml.current;
    if (!m || !lib || !ready || !p.puck) return;
    if (!puck.current) {
      const el = puckElement();
      puck.current = new lib.Marker({ element: el, rotationAlignment: 'map', draggable: p.draggable }).setLngLat([p.puck.lng, p.puck.lat]).addTo(m);
      puck.current.on('drag', () => {
        const ll = puck.current!.getLngLat();
        props.current.onDrag?.({ lat: ll.lat, lng: ll.lng });
      });
    } else if (!puck.current.isDraggable() || !p.draggable) puck.current.setLngLat([p.puck.lng, p.puck.lat]);
    puck.current.setDraggable(p.draggable);
    puck.current.getElement().classList.toggle('puck-draggable', p.draggable);
    puck.current.getElement().classList.toggle('puck-noheading', p.puck.headingDeg === null);
    puck.current.setRotation(p.puck.headingDeg ?? 0);
    if (!p.focus && !(p.results && p.results.length) && !p.draggable) {
      const pd = padFor(p.pad, 0);
      // Use an offset (not camera padding, which persists and would stack with fitBounds padding).
      m.easeTo({ center: [p.puck.lng, p.puck.lat], zoom: p.zoom, duration: 600, offset: [(pd.left - pd.right) / 2, (pd.top - pd.bottom) / 2] });
    }
  }, [p.puck, p.zoom, p.draggable, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mapview">
      <div ref={box} className={`mapview-canvas${tileError && !config.mapStyleUrl ? ' no-tiles' : ''}`} data-testid="map" />
      {tileError && !config.mapStyleUrl ? <p className="map-tile-note t-caption">Map tiles unavailable offline · overlays still live</p> : null}
    </div>
  );
}
