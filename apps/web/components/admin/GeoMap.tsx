'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { geohashDecode } from '@city/core';

/** geohash-5 aggregate map: one dot per k-anonymous cell, area ∝ sessions (sequential single hue). */
export function GeoMap({ cells }: { cells: Array<{ geohash5: string; sessions: number }> }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((lib) => {
      if (cancelled || !box.current) return;
      const pts = cells.map((c) => ({ ...geohashDecode(c.geohash5), s: c.sessions, h: c.geohash5 }));
      const max = Math.max(1, ...pts.map((p) => p.s));
      const m = new lib.Map({
        container: box.current,
        style: {
          version: 8,
          sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#EFEAE1' } },
            { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.9, 'raster-opacity': 0.8 } },
          ],
        },
        center: [-98, 39],
        zoom: 2.6,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.on('load', () => {
        m.addSource('cells', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', properties: { s: p.s, r: 4 + 14 * Math.sqrt(p.s / max) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) },
        });
        m.addLayer({ id: 'cells', type: 'circle', source: 'cells', paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#00879B', 'circle-opacity': 0.75, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } });
        if (pts.length > 0) {
          const b = new lib.LngLatBounds([pts[0]!.lng, pts[0]!.lat], [pts[0]!.lng, pts[0]!.lat]);
          for (const p of pts) b.extend([p.lng, p.lat]);
          m.fitBounds(b, { padding: 50, maxZoom: 9, duration: 0 });
        }
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
    };
  }, [cells]);
  return <div ref={box} className="geomap" role="img" aria-label={`Map of ${cells.length} geohash-5 cells`} />;
}
