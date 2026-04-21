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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  FillLayerSpecification,
  Layer,
  MapMouseEvent,
  MapRef,
  Marker,
  RasterLayerSpecification,
  Source,
  ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GlobeIframe } from './GlobeIframe';
import { HUDPanel } from './HUDPanel';
import { LayerDock, LayerState } from './LayerDock';
import { ISSMarker } from './ISSMarker';
import { LayerSwitcher, BaseLayerId } from './LayerSwitcher';
import { SwipeCompare } from './SwipeCompare';
import { useTilePrefetch } from '../hooks/useTilePrefetch';
import { SavedLocationsPanel, SavedLocation } from './SavedLocationsPanel';
import { SearchBar } from './SearchBar';
import { WorkerTileCache } from '@the-real-earth/tile-cache';
import { SpecOpsFeature } from './SpecOpsToolbar';

const DEFAULT_TILE_SERVER_URL = 'http://localhost:8000';

const TILE_SERVER_URL =
  process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? DEFAULT_TILE_SERVER_URL;
const OWM_KEY = process.env.NEXT_PUBLIC_OWM_KEY ?? '';

const TILE_SERVER_AVAILABLE =
  TILE_SERVER_URL !== '' && TILE_SERVER_URL !== DEFAULT_TILE_SERVER_URL;

// BlueMarble_NextGeneration is only available from GIBS in EPSG:4326; the
// epsg3857 endpoint returns 400 for this layer.  Only use the GIBS proxy when
// the tile server is available (the backend re-requests using epsg4326/500m).
// When the tile server is absent (static/GitHub Pages deployments) the ESRI
// World Imagery layer covers minzoom=0 and serves as the full base layer.
const gibsTileUrl = `${TILE_SERVER_URL}/tiles/gibs/{z}/{x}/{y}.jpg`;

const sentinelTileUrl = `${TILE_SERVER_URL}/tiles/sentinel/{z}/{x}/{y}`;
const ndviTileUrl = `${TILE_SERVER_URL}/tiles/ndvi/{z}/{x}/{y}`;
const sarTileUrl = `${TILE_SERVER_URL}/tiles/sar/{z}/{x}/{y}`;

// EOX Sentinel-2 Cloudless 2020 — free, no auth required, global coverage up to z=14.
// Used as the Sentinel-2 RGB layer fallback on static/GitHub Pages deployments where the
// tile server is not running.  The {z}/{y}/{x} path order matches the WMTS standard
// used by tiles.maps.eox.at.
const EOX_SENTINEL_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';

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

// CARTO dark_only_labels – free, no API key required.
// Transparent raster overlay containing country/city name labels styled in
// white on a transparent background. Designed for overlay on satellite imagery.
const CARTO_LABELS_URL =
  'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png';

// Natural Earth 110m country borders (simplified GeoJSON, ~325 KB).
// Fetched lazily the first time the Borders layer is enabled.
const NATURAL_EARTH_BORDERS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';

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
  // fade-duration=0: tiles pop in instantly — no blurry upscaled parent tile
  // during the 300 ms fade window.
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
};

const esriLayer: RasterLayerSpecification = {
  id: 'esri-layer',
  type: 'raster',
  source: 'esri',
  // Start at z=0 so ESRI covers the full globe at every zoom level.
  // The GIBS Blue Marble layer renders over this at low zoom when available,
  // but if GIBS tiles fail (e.g. wrong tile matrix set, network error) the
  // ESRI layer continues to provide a clean base image instead of showing
  // the empty dark background.
  minzoom: 0,
  // No minzoom: ESRI World Imagery has global coverage from z=0, so it
  // renders at every zoom level and fully replaces GIBS wherever ESRI has
  // data.  Removing the previous minzoom=2 closes the z=0–1 coverage gap
  // that appeared on static/GitHub Pages deployments when the GIBS direct
  // URL was unavailable (BlueMarble_NextGeneration is only in EPSG:4326 but
  // MapLibre needs EPSG:3857 tiles, so those requests 400).
  // fade-duration=0: tiles pop in instantly — eliminates the blurry upscaled
  // parent tile that was visible during the 300 ms cross-fade window, which
  // was particularly noticeable over featureless ocean areas.
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
};

const sentinelLayer: RasterLayerSpecification = {
  id: 'sentinel-layer',
  type: 'raster',
  source: 'sentinel',
  // fade-duration=0: tiles pop in instantly — eliminates the blurry upscaled
  // parent tile visible during the cross-fade window, which is particularly
  // noticeable over featureless areas like Antarctic ice and open ocean.
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
};

const ndviLayer: RasterLayerSpecification = {
  id: 'ndvi-layer',
  type: 'raster',
  source: 'ndvi',
  minzoom: 10,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
};

const sarLayer: RasterLayerSpecification = {
  id: 'sar-layer',
  type: 'raster',
  source: 'sar',
  minzoom: 6,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
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

const labelsLayer: RasterLayerSpecification = {
  id: 'labels-layer',
  type: 'raster',
  source: 'carto-labels',
  paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
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
    borders: false,
    labels: false,
    ndvi: false,
    sar: false,
    swipe: false,
    ir: false,
  });
  const [irIntensity, setIRIntensity] = useState(0.6);
  // Active base layer for the LayerSwitcher (rgb / ndvi / sar)
  const [activeBaseLayer, setActiveBaseLayer] = useState<BaseLayerId>('rgb');
  const [cursorLat, setCursorLat] = useState(20);
  const [cursorLon, setCursorLon] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [termGeoJSON, setTermGeoJSON] = useState<GeoJSON.FeatureCollection>(
    () => buildTerminatorGeoJSON(new Date()),
  );

  // ── Spec-Ops feature state (globe mode only) ───────────────────────────────
  const [specOpsActive, setSpecOpsActive] = useState({
    subsurface: false,
    heroAsset:  false,
    scanner:    false,
    livePulse:  false,
  });

  // ── Current user location (geolocation) ──────────────────────────────────
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function handleLocateMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setUserLocation({ lat, lon });
        setLocating(false);
        mapRef.current?.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
      },
      () => { setLocating(false); },
    );
  }

  const handleSpecOpsChange = useCallback((feature: SpecOpsFeature, enabled: boolean) => {
    setSpecOpsActive((prev: { subsurface: boolean; heroAsset: boolean; scanner: boolean; livePulse: boolean }) => ({
      ...prev, [feature]: enabled,
    }));
  }, []);

  /**
   * mounted — becomes true after the first client-side effect fires.
   * Keeps the 3D canvas (GlobeIframe) and its Worker from being initialised
   * during SSR, which would cause React hydration Error #418.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
  // ── Saved locations ────────────────────────────────────────────────────────
  // Always initialise as [] on both server and client to avoid SSR/hydration
  // mismatch (Error #418). The localStorage value is loaded in a separate
  // useEffect so it only runs on the client, after hydration is complete.
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('earth-saved-locations');
      if (stored) setSavedLocations(JSON.parse(stored) as SavedLocation[]);
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('earth-saved-locations', JSON.stringify(savedLocations));
  }, [savedLocations]);

  function handleAddLocation(name: string) {
    const center = mapRef.current?.getCenter();
    const currentZoom = mapRef.current?.getZoom() ?? zoom;
    if (!center) return;
    const loc: SavedLocation = {
      id: crypto.randomUUID(),
      name,
      lat: center.lat,
      lon: center.lng,
      zoom: currentZoom,
    };
    setSavedLocations((prev) => [...prev, loc]);
  }

  function handleRemoveLocation(id: string) {
    setSavedLocations((prev) => prev.filter((l) => l.id !== id));
  }

  function handleFlyTo(loc: SavedLocation) {
    mapRef.current?.flyTo({ center: [loc.lon, loc.lat], zoom: loc.zoom, duration: 1500 });
  }

  // ── Country borders GeoJSON (lazy-loaded on first enable) ─────────────────
  const [bordersGeoJSON, setBordersGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const bordersLoadedRef = useRef(false);

  useEffect(() => {
    if (!layers.borders || bordersLoadedRef.current) return;
    bordersLoadedRef.current = true;
    fetch(NATURAL_EARTH_BORDERS_URL)
      .then((r) => r.json())
      .then((data: GeoJSON.FeatureCollection) => setBordersGeoJSON(data))
      .catch((err) => {
        console.error('[EarthWebMap] Failed to load country borders:', err);
        bordersLoadedRef.current = false;
      });
  }, [layers.borders]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  /**
   * WorkerTileCache — off-thread tile pre-fetcher using Cache API.
   * Created once per component mount; destroyed on unmount.
   * Falls back gracefully to the `new Image()` path when Web Workers are
   * unavailable (e.g. SSR, certain CSP configurations).
   */
  const workerCache = useMemo(() => new WorkerTileCache(), []);
  useEffect(() => () => workerCache.destroy(), [workerCache]);

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
    ...(TILE_SERVER_AVAILABLE ? [gibsTileUrl] : []),
    ESRI_WORLD_IMAGERY_URL,
    ...(layers.sentinel && TILE_SERVER_AVAILABLE ? [sentinelTileUrl] : []),
    ...(layers.ndvi && TILE_SERVER_AVAILABLE ? [ndviTileUrl] : []),
    ...(layers.sar && TILE_SERVER_AVAILABLE ? [sarTileUrl] : []),
    ...(layers.bathymetry ? [ESRI_OCEAN_BASEMAP_URL] : []),
  ];

  const prefetch = useTilePrefetch(prefetchTemplates, 24, workerCache);

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

  function handleSearchSelect({ lat, lon, zoom: z }: { lat: number; lon: number; zoom: number }) {
    mapRef.current?.flyTo({ center: [lon, lat], zoom: z, duration: 1500 });
  }

  // Swipe Compare mode — renders a full-screen dual-map overlay
  if (layers.swipe) {
    return (
      <SwipeCompare
        tileServerUrl={TILE_SERVER_URL}
        historicalYear={2024}
        initialLng={cursorLon}
        initialLat={cursorLat}
        initialZoom={Math.max(zoom, 3)}
        onClose={() => setLayers((prev) => ({ ...prev, swipe: false }))}
      />
    );
  }

  if (mode === 'globe') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Only initialise the 3D canvas + Worker on the client to prevent
            React hydration Error #418 (SSR/client tree mismatch). */}
        {mounted && (
          <GlobeIframe
            tileServerUrl={TILE_SERVER_URL}
            onSpecOpsChange={handleSpecOpsChange}
            irEnabled={layers.ir}
            irIntensity={irIntensity}
          />
        )}
        <LayerDock
          mode="globe"
          layers={layers}
          onModeToggle={toggleMode}
          onLayerToggle={toggleLayer}
          irIntensity={irIntensity}
          onIRIntensityChange={setIRIntensity}
        />
      </div>
    );
  }

  const activeLayers = {
    clouds: layers.clouds,
    terminator: layers.terminator,
    iss: layers.iss,
    sentinel: layers.sentinel,
    ndvi: layers.ndvi,
    sar: layers.sar,
    bathymetry: layers.bathymetry,
    borders: layers.borders,
    labels: layers.labels,
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
      style={{ position: 'relative', width: '100vw', height: '100vh' }}
    >
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={MINIMAL_DARK_STYLE}
        onMove={handleMove}
        onMouseMove={handleMouseMove}
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
        {/* Base layer: NASA GIBS Blue Marble (proxied via tile server only).
            BlueMarble_NextGeneration is only available from GIBS in EPSG:4326;
            the epsg3857 endpoint returns 400 for this layer.  When the tile
            server is absent (static/GitHub Pages deployments) the ESRI World
            Imagery layer below starts at minzoom=0 and acts as the full base,
            so we skip this source entirely to avoid the 400 console errors. */}
        {TILE_SERVER_AVAILABLE && (
          <Source
            id="gibs"
            type="raster"
            tiles={[gibsTileUrl]}
            tileSize={retinaTileSize}
            maxzoom={8}
          >
            <Layer {...gibsLayer} />
          </Source>
        )}

        {/* High-res gap-fill: ESRI World Imagery (z ≥ 2).
            Always active so that areas without Sentinel-2 coverage (e.g.
            Antarctica) are rendered sharply instead of being upscaled from
            the z=8 GIBS Blue Marble. Falls back gracefully below Sentinel-2
            where the tile server is available.
            Source maxzoom is capped at 17: ESRI World Imagery has near-global
            reliable coverage at z=17. Setting maxzoom higher causes 404s for
            remote/low-density areas at z=18–19 which trigger the
            "Map data not yet available" placeholder; at z=17 MapLibre
            overzooms the tile instead, keeping the map visible everywhere.
            tileSize uses retinaTileSize (128 on DPR≥2) so that HiDPI screens
            request z+1 tiles, matching the sharpness strategy used for GIBS. */}
        <Source
          id="esri"
          type="raster"
          tiles={[ESRI_WORLD_IMAGERY_URL]}
          tileSize={retinaTileSize}
          maxzoom={17}
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
            When the tile server is available, use the proxied Sentinel-2 tiles.
            On static/GitHub Pages deployments, fall back to EOX Sentinel-2
            Cloudless 2020 (free, no auth required, global coverage up to z=14).
            In fallback mode the layer maxzoom is capped at 14 so MapLibre stops
            rendering this layer above z=14 and the ESRI World Imagery layer
            underneath (real tiles up to z=17) shows through — preventing the
            severe blurriness caused by overzooming a z=14 tile to fill z=16+.
            tileSize is kept at 256 (both sources' native output size).
            minzoom=10 matches the server's minimum zoom so MapLibre never
            fires tile requests below z=10 (which always 404 on our backend). */}
        {layers.sentinel && (
          <Source
            id="sentinel"
            type="raster"
            tiles={[TILE_SERVER_AVAILABLE ? sentinelTileUrl : EOX_SENTINEL_URL]}
            tileSize={256}
            minzoom={10}
            maxzoom={TILE_SERVER_AVAILABLE ? 25 : 14}
          >
            <Layer {...sentinelLayer} maxzoom={TILE_SERVER_AVAILABLE ? undefined : 14} />
          </Source>
        )}

        {/* Vegetation health overlay: NDVI colourised (NIR−Red)/(NIR+Red) */}
        {layers.ndvi && TILE_SERVER_AVAILABLE && (
          <Source
            id="ndvi"
            type="raster"
            tiles={[ndviTileUrl]}
            tileSize={256}
            minzoom={10}
            maxzoom={25}
          >
            <Layer {...ndviLayer} />
          </Source>
        )}

        {/* Cloud-piercing SAR: Sentinel-1 grayscale backscatter */}
        {layers.sar && TILE_SERVER_AVAILABLE && (
          <Source
            id="sar"
            type="raster"
            tiles={[sarTileUrl]}
            tileSize={256}
            minzoom={6}
            maxzoom={20}
          >
            <Layer {...sarLayer} />
          </Source>
        )}

        {/* Country borders: Natural Earth 110m GeoJSON line layer */}
        {layers.borders && bordersGeoJSON && (
          <Source id="countries" type="geojson" data={bordersGeoJSON}>
            <Layer
              id="country-borders"
              type="line"
              paint={{
                'line-color': 'rgba(255,255,255,0.55)',
                'line-width': 0.75,
              }}
            />
          </Source>
        )}

        {/* Country name labels: CARTO dark_only_labels transparent raster overlay */}
        {layers.labels && (
          <Source
            id="carto-labels"
            type="raster"
            tiles={[CARTO_LABELS_URL]}
            tileSize={256}
          >
            <Layer {...labelsLayer} />
          </Source>
        )}

        {/* IR: MODIS Terra Land Surface Temperature overlay (adjustable opacity) */}
        {layers.ir && (
          <Source
            id="ir-lst"
            type="raster"
            tiles={['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2023-07-01/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png']}
            tileSize={256}
            maxzoom={7}
          >
            <Layer
              id="ir-lst-layer"
              type="raster"
              source="ir-lst"
              paint={{ 'raster-opacity': irIntensity, 'raster-fade-duration': 0 }}
            />
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

        {/* User current-location marker */}
        {userLocation && (
          <Marker longitude={userLocation.lon} latitude={userLocation.lat} anchor="center">
            <div style={{ pointerEvents: 'none' }} aria-label="Your location">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="rgba(60,130,255,0.18)" stroke="rgba(60,130,255,0.6)" strokeWidth="1.5">
                  <animate attributeName="r" from="6" to="11" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.7" to="0" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx="12" cy="12" r="5" fill="#3c82ff" stroke="white" strokeWidth="2" />
              </svg>
            </div>
          </Marker>
        )}

        {/* Saved view pin markers */}
        {savedLocations.map((loc) => (
          <Marker
            key={loc.id}
            longitude={loc.lon}
            latitude={loc.lat}
            anchor="bottom"
          >
            <div title={loc.name} style={{ cursor: 'pointer' }} onClick={() => handleFlyTo(loc)}>
              <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
                <path
                  d="M9 0C4.03 0 0 4.03 0 9C0 15.75 9 26 9 26C9 26 18 15.75 18 9C18 4.03 13.97 0 9 0Z"
                  fill="#3c82ff"
                  fillOpacity="0.88"
                />
                <circle cx="9" cy="9" r="3.5" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
          </Marker>
        ))}
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
        specOpsActive={specOpsActive}
      />

      {/* Search Bar — top-centre geocoding search */}
      <SearchBar onSelect={handleSearchSelect} />

      {/* Layer Switcher — top-centre segmented control for RGB / NDVI / SAR */}
      {TILE_SERVER_AVAILABLE && (
        <LayerSwitcher
          activeLayer={activeBaseLayer}
          onLayerChange={(id) => {
            setActiveBaseLayer(id);
            // Mirror into LayerState so the relevant overlay source is shown
            setLayers((prev) => ({
              ...prev,
              sentinel: id === 'rgb',
              ndvi: id === 'ndvi',
              sar: id === 'sar',
            }));
          }}
        />
      )}

      {/* Layer Dock */}
      <LayerDock
        mode="map"
        layers={layers}
        onModeToggle={toggleMode}
        onLayerToggle={toggleLayer}
        irIntensity={irIntensity}
        onIRIntensityChange={setIRIntensity}
      />

      {/* My Location button */}
      <button
        style={{
          position: 'absolute',
          bottom: 40,
          left: 76,
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(8,12,30,0.82)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: userLocation ? '1px solid #3c82ff' : '1px solid rgba(80,160,255,0.18)',
          borderRadius: 10,
          cursor: locating ? 'wait' : 'pointer',
          zIndex: 10,
          fontSize: '1.2rem',
          animation: 'slideInLeft 0.5s cubic-bezier(0.22,1,0.36,1) 1.3s both',
          boxShadow: userLocation ? '0 0 12px 2px rgba(60,130,255,0.3)' : 'none',
        }}
        onClick={handleLocateMe}
        title="My Location"
        type="button"
        aria-label="My Location"
      >
        {locating ? '⏳' : '📍'}
      </button>

      {/* Saved views panel */}
      <SavedLocationsPanel
        locations={savedLocations}
        onAdd={handleAddLocation}
        onRemove={handleRemoveLocation}
        onFlyTo={handleFlyTo}
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
