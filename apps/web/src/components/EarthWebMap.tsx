'use client';

/**
 * apps/web/src/components/EarthWebMap.tsx
 *
 * Primary web map component using react-map-gl (Mapbox GL JS).
 *
 * Layers
 * ------
 *  1. NASA GIBS Blue Marble base raster (z ≤ 8)
 *  2. Cloud-free Sentinel-2 composite overlay (z ≥ 10)
 *
 * Features
 * --------
 *  - Toggle to CesiumJS globe (iframe) via a floating button
 *  - Debounced viewport callbacks for tile prefetching (150 ms)
 *  - WebP tile requests via Accept header (handled by the tile server)
 */

import React, { useCallback, useRef, useState } from 'react';
import Map, {
  Layer,
  MapRef,
  RasterLayer,
  Source,
  ViewStateChangeEvent,
} from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { GlobeIframe } from './GlobeIframe';

const TILE_SERVER_URL =
  process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? 'http://localhost:8000';
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const gibsLayer: RasterLayer = {
  id: 'gibs-layer',
  type: 'raster',
  source: 'gibs',
  maxzoom: 9,
  paint: { 'raster-opacity': 1 },
};

const sentinelLayer: RasterLayer = {
  id: 'sentinel-layer',
  type: 'raster',
  source: 'sentinel',
  minzoom: 10,
  paint: { 'raster-opacity': 1 },
};

const DEBOUNCE_MS = 150;

export function EarthWebMap(): React.ReactElement {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  const handleMove = useCallback((evt: ViewStateChangeEvent) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Viewport changed — could trigger prefetch logic here
      const { zoom, longitude, latitude } = evt.viewState;
      console.debug('[EarthWebMap] viewport', { zoom, longitude, latitude });
    }, DEBOUNCE_MS);
  }, []);

  if (mode === 'globe') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <GlobeIframe tileServerUrl={TILE_SERVER_URL} />
        <button
          onClick={() => setMode('map')}
          style={buttonStyle}
        >
          🗺️ Map
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        onMove={handleMove}
        maxZoom={20}
      >
        {/* Base layer: NASA GIBS Blue Marble */}
        <Source
          id="gibs"
          type="raster"
          tiles={[`${TILE_SERVER_URL}/tiles/gibs/{z}/{x}/{y}.jpg`]}
          tileSize={256}
          maxzoom={8}
        >
          <Layer {...gibsLayer} />
        </Source>

        {/* High-res overlay: Sentinel-2 cloud-free composite */}
        <Source
          id="sentinel"
          type="raster"
          tiles={[`${TILE_SERVER_URL}/tiles/sentinel/{z}/{x}/{y}`]}
          tileSize={256}
          minzoom={10}
          maxzoom={20}
        >
          <Layer {...sentinelLayer} />
        </Source>
      </Map>

      <button
        onClick={() => setMode('globe')}
        style={buttonStyle}
      >
        🌐 Globe
      </button>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  padding: '10px 16px',
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 8,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
};
