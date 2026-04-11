'use client';

/**
 * apps/web/src/components/SwipeCompare.tsx
 *
 * Time-Machine side-by-side swipe compare for the web map.
 *
 * Renders two full-size MapLibre GL maps in absolutely-positioned containers:
 *  - Left  (historical): Sentinel-2 composite filtered to `historicalYear`
 *                        via ?year=YYYY query parameter.
 *  - Right (current):    Sentinel-2 composite at the default (latest) year.
 *
 * A draggable <input type="range"> divider clips the right map using
 * CSS clip-path so exactly the "right portion" of the current imagery is
 * visible, creating a seamless split-screen comparison.
 *
 * Both maps are kept in viewport sync: moving one map broadcasts the
 * new center/zoom to the other via a shared ref.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Map, {
  Layer,
  MapRef,
  RasterLayerSpecification,
  Source,
  ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Layer spec constants ──────────────────────────────────────────────────────

const BASE_LAYER: RasterLayerSpecification = {
  id: 'esri-layer',
  type: 'raster',
  source: 'esri',
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const SENTINEL_LAYER_HIST: RasterLayerSpecification = {
  id: 'sentinel-hist-layer',
  type: 'raster',
  source: 'sentinel-hist',
  minzoom: 10,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const SENTINEL_LAYER_CURR: RasterLayerSpecification = {
  id: 'sentinel-curr-layer',
  type: 'raster',
  source: 'sentinel-curr',
  minzoom: 10,
  paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 300 },
};

const ESRI_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const MINIMAL_DARK_STYLE = {
  version: 8 as const,
  sources: {} as Record<string, never>,
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#050814' } }],
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  tileServerUrl: string;
  historicalYear?: number;
  initialLng?: number;
  initialLat?: number;
  initialZoom?: number;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SwipeCompare({
  tileServerUrl,
  historicalYear = 2024,
  initialLng = 0,
  initialLat = 20,
  initialZoom = 3,
  onClose,
}: Props) {
  // Divider position as a percentage [0, 100]
  const [splitPct, setSplitPct] = useState(50);
  // Shared viewport state kept in refs to avoid react re-render on every move
  const leftRef = useRef<MapRef | null>(null);
  const rightRef = useRef<MapRef | null>(null);
  const syncingRef = useRef(false);

  const SENTINEL_HIST_URL = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}?year=${historicalYear}`;
  const SENTINEL_CURR_URL = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}`;

  const syncLeft = useCallback((evt: ViewStateChangeEvent) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    rightRef.current?.jumpTo({
      center: [evt.viewState.longitude, evt.viewState.latitude],
      zoom: evt.viewState.zoom,
      bearing: evt.viewState.bearing,
      pitch: evt.viewState.pitch,
    });
    syncingRef.current = false;
  }, []);

  const syncRight = useCallback((evt: ViewStateChangeEvent) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    leftRef.current?.jumpTo({
      center: [evt.viewState.longitude, evt.viewState.latitude],
      zoom: evt.viewState.zoom,
      bearing: evt.viewState.bearing,
      pitch: evt.viewState.pitch,
    });
    syncingRef.current = false;
  }, []);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSplitPct(Number(e.target.value));
  };

  return (
    <div style={outerWrap}>
      {/* ── Left map: historical ─────────────────────────────────────── */}
      <div style={{ ...mapWrap, width: '100%', height: '100%' }}>
        <Map
          ref={leftRef}
          initialViewState={{ longitude: initialLng, latitude: initialLat, zoom: initialZoom }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MINIMAL_DARK_STYLE}
          onMove={syncLeft}
          pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1}
        >
          <Source id="esri" type="raster" tiles={[ESRI_URL]} tileSize={256} maxzoom={19}>
            <Layer {...BASE_LAYER} />
          </Source>
          <Source id="sentinel-hist" type="raster" tiles={[SENTINEL_HIST_URL]}
            tileSize={256} minzoom={10} maxzoom={25}>
            <Layer {...SENTINEL_LAYER_HIST} />
          </Source>
        </Map>
      </div>

      {/* ── Right map: current (clipped to right portion) ──────────── */}
      <div
        style={{
          ...mapWrap,
          position: 'absolute',
          inset: 0,
          clipPath: `inset(0 0 0 ${splitPct}%)`,
          transition: 'clip-path 0s',   // no transition — handle drag updates this in real-time
        }}
      >
        <Map
          ref={rightRef}
          initialViewState={{ longitude: initialLng, latitude: initialLat, zoom: initialZoom }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MINIMAL_DARK_STYLE}
          onMove={syncRight}
          pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1}
        >
          <Source id="esri2" type="raster" tiles={[ESRI_URL]} tileSize={256} maxzoom={19}>
            <Layer {...{ ...BASE_LAYER, id: 'esri-layer-2', source: 'esri2' }} />
          </Source>
          <Source id="sentinel-curr" type="raster" tiles={[SENTINEL_CURR_URL]}
            tileSize={256} minzoom={10} maxzoom={25}>
            <Layer {...SENTINEL_LAYER_CURR} />
          </Source>
        </Map>
      </div>

      {/* ── Draggable divider ──────────────────────────────────────── */}
      <div style={{ ...dividerWrap, left: `${splitPct}%` }} aria-hidden>
        <div style={dividerLine} />
        <div style={dividerKnob}>◀ ▶</div>
        <div style={dividerLine} />
      </div>

      {/* Hidden range input covers the full width for drag interaction */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={splitPct}
        onChange={handleSlider}
        style={rangeInput}
        aria-label="Swipe compare position"
      />

      {/* ── Year labels ──────────────────────────────────────────────── */}
      <div style={{ ...yearLabel, left: 16 }} aria-label={`Historical: ${historicalYear}`}>
        {historicalYear}
      </div>
      <div style={{ ...yearLabel, right: 16 }} aria-label="Current: 2026">
        2026
      </div>

      {/* ── Close button ─────────────────────────────────────────────── */}
      <button type="button" style={closeBtn} onClick={onClose}>
        ✕ Exit Compare
      </button>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const outerWrap: React.CSSProperties = {
  position: 'relative',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
  userSelect: 'none',
};

const mapWrap: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
};

const dividerWrap: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 44,
  marginLeft: -22,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  pointerEvents: 'none',
  zIndex: 8,
};

const dividerLine: React.CSSProperties = {
  flex: 1,
  width: 2,
  background: 'rgba(255,255,255,0.85)',
};

const dividerKnob: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: 'rgba(8,12,30,0.92)',
  border: '2px solid rgba(255,255,255,0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: -1,
  flexShrink: 0,
};

const rangeInput: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  padding: 0,
  opacity: 0,
  cursor: 'col-resize',
  zIndex: 9,
  appearance: 'none',
  WebkitAppearance: 'none',
};

const yearLabel: React.CSSProperties = {
  position: 'absolute',
  top: 64,
  background: 'rgba(8,12,30,0.82)',
  borderRadius: 6,
  padding: '4px 10px',
  border: '1px solid rgba(80,160,255,0.25)',
  color: 'rgba(150,200,255,0.9)',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  fontFamily: 'ui-monospace, monospace',
  pointerEvents: 'none',
  zIndex: 10,
};

const closeBtn: React.CSSProperties = {
  position: 'absolute',
  top: 64,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(8,12,30,0.92)',
  border: '1px solid rgba(80,160,255,0.3)',
  borderRadius: 20,
  padding: '7px 18px',
  color: 'rgba(150,200,255,0.9)',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
  zIndex: 10,
};
