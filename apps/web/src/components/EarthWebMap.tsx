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
 *  3. Day/Night terminator polygon (real-time, redrawn every 60 s)
 *  4. OpenWeatherMap cloud tiles (optional, toggled by user)
 *
 * Features
 * --------
 *  - Toggle to CesiumJS globe (iframe) via LayerDock
 *  - HUD panel with live coordinates, zoom, UTC clock, layer status
 *  - ISS live position marker (pulsing ring, tooltip card)
 *  - Crosshair + coordinate readout at map centre
 *  - Attribution status bar
 *  - Debounced viewport callbacks for tile prefetching (150 ms)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Map, {
  FillLayer,
  Layer,
  MapMouseEvent,
  MapRef,
  RasterLayer,
  Source,
  ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GlobeIframe } from './GlobeIframe';
import { HUDPanel } from './HUDPanel';
import { LayerDock, LayerState } from './LayerDock';
import { ISSMarker } from './ISSMarker';

const DEFAULT_TILE_SERVER_URL = 'http://localhost:8000';

const TILE_SERVER_URL =
  process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? DEFAULT_TILE_SERVER_URL;
const OWM_KEY = process.env.NEXT_PUBLIC_OWM_KEY ?? '';

// When the tile server is not available (e.g. GitHub Pages static deployment),
// fetch Blue Marble tiles directly from NASA GIBS instead of through the proxy.
// GIBS WMTS uses {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x} in XYZ terms.
const GIBS_DIRECT_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
  '/BlueMarble_NextGeneration/default/2004-08-01' +
  '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';

const TILE_SERVER_AVAILABLE =
  TILE_SERVER_URL !== '' && TILE_SERVER_URL !== DEFAULT_TILE_SERVER_URL;

const gibsTileUrl = TILE_SERVER_AVAILABLE
  ? `${TILE_SERVER_URL}/tiles/gibs/{z}/{x}/{y}.jpg`
  : GIBS_DIRECT_URL;

const sentinelTileUrl = `${TILE_SERVER_URL}/tiles/sentinel/{z}/{x}/{y}`;

// When no Mapbox token is provided (static/GitHub Pages deployments) fall back
// to a minimal inline style so the map canvas is visible instead of black.
const MINIMAL_DARK_STYLE = {
  version: 8 as const,
  sources: {} as Record<string, never>,
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#050814' } }],
};

// ── Layer spec objects ────────────────────────────────────────────────────────

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

const terminatorFillLayer: FillLayer = {
  id: 'terminator-fill',
  type: 'fill',
  source: 'terminator',
  paint: {
    'fill-color': '#000820',
    'fill-opacity': 0.38,
  },
};

const cloudsLayer: RasterLayer = {
  id: 'clouds-layer',
  type: 'raster',
  source: 'clouds',
  paint: { 'raster-opacity': 0.7 },
};

// ── Day/Night terminator geometry ─────────────────────────────────────────────

/**
 * Compute the solar sub-point (lat, lon) for a given UTC date,
 * then generate a GeoJSON polygon covering the night hemisphere.
 *
 * Algorithm: approximate solar declination + hour angle.
 */
function buildTerminatorGeoJSON(date: Date): GeoJSON.FeatureCollection {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getUTCFullYear(), 0, 0).getTime()) / 86400000,
  );

  // Solar declination (degrees)
  const declination =
    -23.45 * Math.cos((360 / 365.25) * (dayOfYear + 10) * (Math.PI / 180));

  // UTC fractional hours → Greenwich Hour Angle → subsolar longitude
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const subsolarLon = (utcHours / 24) * -360 + 180;

  const declRad = declination * (Math.PI / 180);

  // Build terminator line: for each longitude step, find latitude where
  // solar zenith angle = 90°.
  // Formula: tan(lat) = -cos(HA) / tan(decl), where HA = lon - subsolarLon
  function terminatorLatitude(lonRad: number): number {
    if (Math.abs(declRad) < 1e-9) {
      // Equinox: terminator is a meridian
      return lonRad > -Math.PI / 2 && lonRad < Math.PI / 2 ? 90 : -90;
    }
    return Math.atan(-Math.cos(lonRad) / Math.tan(declRad)) * (180 / Math.PI);
  }

  const STEPS = 361;
  const coords: Array<[number, number]> = [];

  for (let i = 0; i < STEPS; i++) {
    const lon = -180 + (360 * i) / (STEPS - 1);
    const lonRad = (lon - subsolarLon) * (Math.PI / 180);
    coords.push([lon, terminatorLatitude(lonRad)]);
  }

  // Determine if the north or south pole is in night
  const northInNight = declination < 0;

  // Build a closed polygon: terminator line + one pole cap
  const poleLat = northInNight ? -90 : 90;
  const polygon: Array<[number, number]> = [
    ...coords,
    [180, poleLat],
    [-180, poleLat],
    coords[0],
  ];

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [polygon] },
        properties: {},
      },
    ],
  };
}

const DEBOUNCE_MS = 150;

// ── Component ─────────────────────────────────────────────────────────────────

export function EarthWebMap() {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const [layers, setLayers] = useState<LayerState>({
    clouds: false,
    terminator: true,
    iss: true,
    sentinel: true,
  });
  const [cursorLat, setCursorLat] = useState(20);
  const [cursorLon, setCursorLon] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [termGeoJSON, setTermGeoJSON] = useState<GeoJSON.FeatureCollection>(
    () => buildTerminatorGeoJSON(new Date()),
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  // Update terminator every 60 s
  useEffect(() => {
    const id = setInterval(() => {
      setTermGeoJSON(buildTerminatorGeoJSON(new Date()));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const handleMove = useCallback((evt: ViewStateChangeEvent) => {
    const { zoom: z, longitude, latitude } = evt.viewState;
    setCursorLat(latitude);
    setCursorLon(longitude);
    setZoom(z);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[EarthWebMap] viewport', { z, longitude, latitude });
      }
    }, DEBOUNCE_MS);
  }, []);

  const handleMouseMove = useCallback(
    (evt: MapMouseEvent) => {
      if (!evt.lngLat) return;
      setCursorLat(evt.lngLat.lat);
      setCursorLon(evt.lngLat.lng);
    },
    [],
  );

  function toggleLayer(key: keyof LayerState) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleMode() {
    setMode((m) => (m === 'map' ? 'globe' : 'map'));
  }

  if (mode === 'globe') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <GlobeIframe tileServerUrl={TILE_SERVER_URL} />
        <LayerDock
          mode="globe"
          layers={layers}
          onModeToggle={toggleMode}
          onLayerToggle={toggleLayer}
        />
      </div>
    );
  }

  const activeLayers = {
    clouds: layers.clouds,
    terminator: layers.terminator,
    iss: layers.iss,
    sentinel: layers.sentinel,
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={MINIMAL_DARK_STYLE}
        onMove={handleMove}
        onMouseMove={handleMouseMove}
        maxZoom={20}
      >
        {/* Base layer: NASA GIBS Blue Marble (direct or proxied) */}
        <Source
          id="gibs"
          type="raster"
          tiles={[gibsTileUrl]}
          tileSize={256}
          maxzoom={8}
        >
          <Layer {...gibsLayer} />
        </Source>

        {/* High-res overlay: Sentinel-2 cloud-free composite */}
        {layers.sentinel && TILE_SERVER_AVAILABLE && (
          <Source
            id="sentinel"
            type="raster"
            tiles={[sentinelTileUrl]}
            tileSize={256}
            minzoom={10}
            maxzoom={20}
          >
            <Layer {...sentinelLayer} />
          </Source>
        )}

        {/* Day/Night terminator */}
        {layers.terminator && (
          <Source id="terminator" type="geojson" data={termGeoJSON}>
            <Layer {...terminatorFillLayer} />
          </Source>
        )}

        {/* OpenWeatherMap cloud tiles (requires OWM API key in .env) */}
        {layers.clouds && OWM_KEY && (
          <Source
            id="clouds"
            type="raster"
            tiles={[
              `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,
            ]}
            tileSize={256}
          >
            <Layer {...cloudsLayer} />
          </Source>
        )}

        {/* ISS live position marker */}
        <ISSMarker enabled={layers.iss} />
      </Map>

      {/* Crosshair */}
      <div style={crosshairOuter} aria-hidden>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <line x1="16" y1="2"  x2="16" y2="12" stroke="rgba(80,160,255,0.7)" strokeWidth="1.5" />
          <line x1="16" y1="20" x2="16" y2="30" stroke="rgba(80,160,255,0.7)" strokeWidth="1.5" />
          <line x1="2"  y1="16" x2="12" y2="16" stroke="rgba(80,160,255,0.7)" strokeWidth="1.5" />
          <line x1="20" y1="16" x2="30" y2="16" stroke="rgba(80,160,255,0.7)" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="2.5" stroke="rgba(80,160,255,0.9)" strokeWidth="1.2" />
        </svg>
      </div>

      {/* HUD Panel */}
      <HUDPanel
        lat={cursorLat}
        lon={cursorLon}
        zoom={zoom}
        activeLayers={activeLayers}
      />

      {/* Layer Dock */}
      <LayerDock
        mode="map"
        layers={layers}
        onModeToggle={toggleMode}
        onLayerToggle={toggleLayer}
      />

      {/* Attribution bar */}
      <div style={attributionBar}>
        <span>
          🌍{' '}
          <a
            href="https://nasa.gov/gibs"
            target="_blank"
            rel="noopener noreferrer"
            style={attrLink}
          >
            NASA GIBS
          </a>
          {' · '}
          <a
            href="https://sentinel.esa.int"
            target="_blank"
            rel="noopener noreferrer"
            style={attrLink}
          >
            ESA Sentinel-2
          </a>
          {' · '}
          <a
            href="https://wheretheiss.at"
            target="_blank"
            rel="noopener noreferrer"
            style={attrLink}
          >
            wheretheiss.at
          </a>
        </span>
        <span>ZOOM {zoom.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const crosshairOuter: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
  zIndex: 5,
  opacity: 0.75,
};

const attributionBar: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 26,
  background: 'rgba(5,8,20,0.82)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  borderTop: '1px solid rgba(80,160,255,0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 12px',
  fontSize: '0.62rem',
  fontFamily: 'ui-monospace, monospace',
  color: 'rgba(150,200,255,0.5)',
  letterSpacing: '0.04em',
  zIndex: 10,
};

const attrLink: React.CSSProperties = {
  color: 'rgba(150,200,255,0.7)',
  textDecoration: 'none',
};
