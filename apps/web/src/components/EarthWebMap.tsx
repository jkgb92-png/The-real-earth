'use client';

/**
 * apps/web/src/components/EarthWebMap.tsx
 *
 * Primary web map component using react-map-gl (Mapbox GL JS).
 *
 * Layers
 * ------
 *  1. NASA GIBS Blue Marble base raster (z ≤ 8, nearest resampling)
 *  2. ESRI World Imagery gap-fill (z ≥ 8, nearest resampling) — sharp at all zooms including Antarctica
 *  3. Cloud-free Sentinel-2 composite overlay (z ≥ 10, tile-server only)
 *  4. Day/Night terminator polygon (real-time, redrawn every 60 s)
 *  5. OpenWeatherMap cloud tiles (optional, toggled by user)
 *  6. Ocean floor bathymetry — ESRI Ocean Basemap (optional, toggled by user)
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
  FillLayerSpecification,
  Layer,
  MapMouseEvent,
  MapRef,
  RasterLayerSpecification,
  Source,
  ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GlobeIframe } from './GlobeIframe';
import { HUDPanel } from './HUDPanel';
import { LayerDock, LayerState } from './LayerDock';
import { ISSMarker } from './ISSMarker';
import { useTilePrefetch } from '../hooks/useTilePrefetch';

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

// Free ESRI World Imagery tiles – up to zoom 19, no auth required.
// Used as a high-resolution gap-fill at z ≥ 9 to cover areas (e.g. Antarctica)
// where Sentinel-2 tiles are unavailable, and as the sole high-res source on
// static/GitHub Pages deployments where the tile server is not available.
const ESRI_WORLD_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// ESRI Ocean Basemap – free, no auth required.
// Renders ocean floor bathymetry (GEBCO-derived depth shading) with terrain for land.
const ESRI_OCEAN_BASEMAP_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';

// When no Mapbox token is provided (static/GitHub Pages deployments) fall back
// to a minimal inline style so the map canvas is visible instead of black.
const MINIMAL_DARK_STYLE = {
  version: 8 as const,
  sources: {} as Record<string, never>,
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#050814' } }],
};

// ── Layer spec objects ────────────────────────────────────────────────────────

const gibsLayer: RasterLayerSpecification = {
  id: 'gibs-layer',
  type: 'raster',
  source: 'gibs',
  // No maxzoom cap: tiles are limited to z≤8 on the source, but the layer
  // continues to overzoom them at higher map zooms so there is always a base
  // image underneath ESRI (preventing the "Map data not yet available" gap
  // when ESRI tiles fail to load or have no coverage for a given area).
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const esriLayer: RasterLayerSpecification = {
  id: 'esri-layer',
  type: 'raster',
  source: 'esri',
  // Start at z=2 so ESRI covers the full globe from low zoom levels.
  // Previously set to z=8 to close the GIBS z=8–9 gap, but that left
  // high-latitude regions (Canada, Arctic, ~60°N+) rendering only the GIBS
  // Blue Marble layer, which shows featureless pure-white tiles at those
  // latitudes (snow/ice with no detail). ESRI World Imagery has real
  // satellite coverage for polar regions and now renders from zoom 2
  // upward, fully replacing GIBS wherever ESRI has data.
  minzoom: 2,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const sentinelLayer: RasterLayerSpecification = {
  id: 'sentinel-layer',
  type: 'raster',
  source: 'sentinel',
  minzoom: 10,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const bathymetryLayer: RasterLayerSpecification = {
  id: 'bathymetry-layer',
  type: 'raster',
  source: 'bathymetry',
  // Rendered above ESRI so the ocean-depth shading is visible as an overlay.
  paint: { 'raster-opacity': 0.75, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
};

const terminatorFillLayer: FillLayerSpecification = {
  id: 'terminator-fill',
  type: 'fill',
  source: 'terminator',
  paint: {
    'fill-color': '#000820',
    'fill-opacity': 0.38,
  },
};

const cloudsLayer: RasterLayerSpecification = {
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
    bathymetry: false,
  });
  const [cursorLat, setCursorLat] = useState(20);
  const [cursorLon, setCursorLon] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [termGeoJSON, setTermGeoJSON] = useState<GeoJSON.FeatureCollection>(
    () => buildTerminatorGeoJSON(new Date()),
  );

  /**
   * tilesLoading — true while the map is moving/zooming and new tiles are
   * in-flight; false once MapLibre fires the `idle` event (all visible tiles
   * have been painted). Used to drive the CSS blur-up transition.
   */
  const [tilesLoading, setTilesLoading] = useState(false);

  /**
   * dpr — device pixel ratio, read client-side to avoid SSR mismatches.
   * Passed as `pixelRatio` to the MapLibre Map so that:
   *  1. The WebGL canvas is sized at the full physical resolution of the screen.
   *  2. MapLibre's tile-selection algorithm requests tiles at a zoom level
   *     that provides ~tileSize * dpr physical pixels per tile, meaning Retina
   *     (DPR=2) screens automatically receive z+1 tiles for crisp 1:1 rendering.
   */
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
    // Re-sync if the user moves the browser window to a different monitor.
    const mql = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const onDprChange = () => setDpr(window.devicePixelRatio || 1);
    mql.addEventListener('change', onDprChange);
    return () => mql.removeEventListener('change', onDprChange);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  /**
   * Active tile URL templates for pre-fetching.
   * Always include the base layers; conditionally add optional layers.
   * URLs must use {z}/{x}/{y} substitution tokens.
   *
   * Note: ESRI uses {z}/{y}/{x} order in the path, but the template tokens
   * ({z}, {x}, {y}) are still substituted by our hook — so the substitution
   * is correct regardless of path order.
   */
  const prefetchTemplates = [
    gibsTileUrl,
    ESRI_WORLD_IMAGERY_URL,
    ...(layers.sentinel && TILE_SERVER_AVAILABLE ? [sentinelTileUrl] : []),
    ...(layers.bathymetry ? [ESRI_OCEAN_BASEMAP_URL] : []),
  ];

  const prefetch = useTilePrefetch(prefetchTemplates);

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

    // Mark tiles as loading so the blur-up CSS class is applied immediately.
    setTilesLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Pre-fetch surrounding tiles once the viewport settles.
      const map = mapRef.current;
      if (map) {
        const bounds = map.getBounds();
        if (bounds) {
          prefetch({
            zoom: z,
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          });
        }
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug('[EarthWebMap] viewport', { z, longitude, latitude });
      }
    }, DEBOUNCE_MS);
  }, [prefetch]);

  /**
   * handleIdle — fired by MapLibre once all pending tiles have been painted.
   * Clears the tilesLoading flag so the CSS blur-up transition plays forward
   * (blurry → sharp) rather than staying blurred indefinitely.
   */
  const handleIdle = useCallback(() => {
    setTilesLoading(false);
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
    bathymetry: layers.bathymetry,
  };

  /**
   * retinaTileSize — the value passed to every raster <Source tileSize={…}>.
   *
   * How the @2x / tileSize pattern works
   * ─────────────────────────────────────
   * When a tile provider serves native 512 px (@2x) tiles you set
   * tileSize={256}: MapLibre renders each 512 px tile into 256 CSS pixels.
   * On a DPR=2 (Retina) screen, 256 CSS px = 512 physical px — a perfect 1:1
   * match. On a DPR=1 screen, 256 CSS px = 256 physical px with 512 px of
   * source data — a 2× downsample, which is still sharp.
   *
   * Our sources (ESRI, GIBS, OWM) serve 256 px tiles with no @2x endpoint.
   * For those, we use tileSize={128} on retina: MapLibre requests tiles at
   * zoom+1, rendering each 256 px tile into 128 CSS px = 256 physical px at
   * DPR=2 (1:1 sharp). The cost is ~4× as many requests; the gain is
   * pixel-perfect imagery on high-DPI screens.
   *
   * For our own Sentinel tile server (future @2x support):
   *   tiles={[`${TILE_SERVER_URL}/tiles/sentinel/{z}/{x}/{y}@2x`]}
   *   tileSize={256}   ← always 256, regardless of DPR
   */
  const retinaTileSize = dpr >= 2 ? 128 : 256;

  return (
    <div
      className={`map-blur-wrapper${tilesLoading ? ' tiles-loading' : ''}`}
      style={{ position: 'relative', width: '100vw', height: '100vh' }}
    >
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={MINIMAL_DARK_STYLE}
        onMove={handleMove}
        onMouseMove={handleMouseMove}
        onIdle={handleIdle}
        maxZoom={24}
        /**
         * pixelRatio — explicitly set to the screen's device pixel ratio so
         * MapLibre sizes its WebGL canvas at full physical resolution and
         * adjusts its tile-selection zoom accordingly. On a Retina/2× screen
         * this causes MapLibre to request tiles from zoom+1, meaning each
         * 256 px tile is rendered into 128 CSS px = 256 physical px (1:1
         * sharpness) instead of being stretched 2× into 256 CSS px.
         *
         * This is the recommended retina approach for sources that serve
         * standard 256 px tiles (ESRI, GIBS, OWM).
         *
         * For sources that serve native @2x (512 px) tiles — e.g. our own
         * Sentinel tile server if upgraded — pair the @2x URL with
         * tileSize={256}: MapLibre renders the 512 px tile into 256 CSS px,
         * which on a 2× screen maps exactly to 512 physical px (1:1).
         */
        pixelRatio={dpr}
      >
        {/* Base layer: NASA GIBS Blue Marble (direct or proxied) */}
        <Source
          id="gibs"
          type="raster"
          tiles={[gibsTileUrl]}
          tileSize={retinaTileSize}
          maxzoom={8}
        >
          <Layer {...gibsLayer} />
        </Source>

        {/* High-res gap-fill: ESRI World Imagery (z ≥ 8).
            Always active so that areas without Sentinel-2 coverage (e.g.
            Antarctica) are rendered sharply instead of being upscaled from
            the z=8 GIBS Blue Marble. Falls back gracefully below Sentinel-2
            where the tile server is available.
            Source maxzoom is set to 19: ESRI has native imagery tiles at that
            level across most of the globe, so MapLibre only needs to overzoom
            by 2–3 levels at zoom 20–22 rather than 7+ levels from z=14. */}
        <Source
          id="esri"
          type="raster"
          tiles={[ESRI_WORLD_IMAGERY_URL]}
          tileSize={retinaTileSize}
          maxzoom={19}
        >
          <Layer {...esriLayer} />
        </Source>

        {/* Bathymetry: ESRI Ocean Basemap (GEBCO-derived depth shading).
            Placed above ESRI World Imagery so the semi-transparent ocean-depth
            overlay is actually visible instead of being hidden beneath it. */}
        {layers.bathymetry && (
          <Source
            id="bathymetry"
            type="raster"
            tiles={[ESRI_OCEAN_BASEMAP_URL]}
            tileSize={retinaTileSize}
            maxzoom={12}
          >
            <Layer {...bathymetryLayer} />
          </Source>
        )}

        {/* High-res overlay: Sentinel-2 cloud-free composite.
            tileSize is kept at 256 (our server's native output size).
            When the backend gains @2x support, update the tile URL to
            sentinelTileUrl + '@2x' and keep tileSize={256} — MapLibre will
            render the 512 px tile into 256 CSS px (1:1 on Retina). */}
        {layers.sentinel && TILE_SERVER_AVAILABLE && (
          <Source
            id="sentinel"
            type="raster"
            tiles={[sentinelTileUrl]}
            tileSize={256}
            minzoom={10}
            maxzoom={25}
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
            tileSize={retinaTileSize}
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
            href="https://www.esri.com"
            target="_blank"
            rel="noopener noreferrer"
            style={attrLink}
          >
            Esri World Imagery
          </a>
          {TILE_SERVER_AVAILABLE && (
            <>
              {' · '}
              <a
                href="https://sentinel.esa.int"
                target="_blank"
                rel="noopener noreferrer"
                style={attrLink}
              >
                ESA Sentinel-2
              </a>
            </>
          )}
          {layers.bathymetry && (
            <>
              {' · '}
              <a
                href="https://www.gebco.net"
                target="_blank"
                rel="noopener noreferrer"
                style={attrLink}
              >
                GEBCO / Esri Ocean
              </a>
            </>
          )}
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
