'use client';

/**
 * apps/web/src/components/HUDPanel.tsx
 *
 * Glassmorphism HUD sidebar (right edge, collapsible).
 *
 * Displays:
 *  - Live UTC clock
 *  - Cursor lat/lon (updated by EarthWebMap via prop)
 *  - Current zoom level
 *  - Active layer list (read-only display; toggles live in LayerDock)
 */

import React, { useEffect, useState } from 'react';

export interface ActiveLayers {
  clouds: boolean;
  terminator: boolean;
  iss: boolean;
  sentinel: boolean;
  bathymetry: boolean;
  borders: boolean;
  labels: boolean;
}

interface Props {
  lat: number;
  lon: number;
  zoom: number;
  activeLayers: ActiveLayers;
}

function useUTCClock(): string {
  const [time, setTime] = useState('');
  useEffect(() => {
    setTime(new Date().toUTCString().slice(17, 25));
    const id = setInterval(() => {
      setTime(new Date().toUTCString().slice(17, 25));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function HUDPanel({ lat, lon, zoom, activeLayers }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const utcTime = useUTCClock();

  const layerRows: Array<{ key: keyof ActiveLayers; label: string; icon: string }> = [
    { key: 'sentinel',    label: 'Sentinel-2',    icon: '📡' },
    { key: 'bathymetry',  label: 'Bathymetry',    icon: '🌊' },
    { key: 'terminator',  label: 'Day/Night',      icon: '🌙' },
    { key: 'clouds',      label: 'Live Clouds',    icon: '☁' },
    { key: 'iss',         label: 'ISS Tracker',    icon: '🛰' },
    { key: 'borders',     label: 'Borders',        icon: '🗺️' },
    { key: 'labels',      label: 'Country Names',  icon: '🔤' },
  ];

  return (
    <div style={{ ...panel, animation: 'slideInRight 0.5s cubic-bezier(0.22,1,0.36,1) 1s both' }}>
      {/* Collapse toggle */}
      <button style={collapseBtn} onClick={() => setCollapsed((c) => !c)} type="button">
        {collapsed ? '◂' : '▸'}
      </button>

      {!collapsed && (
        <div style={content}>
          {/* UTC Clock */}
          <div style={section}>
            <div style={sectionLabel}>UTC</div>
            <div style={{ ...monoValue, fontSize: '1.1rem', color: '#7eb8ff' }}>
              {utcTime}
            </div>
          </div>

          <div style={divider} />

          {/* Coordinates */}
          <div style={section}>
            <div style={sectionLabel}>CURSOR</div>
            <div style={monoValue}>
              {lat.toFixed(4)}° {lat >= 0 ? 'N' : 'S'}
            </div>
            <div style={monoValue}>
              {Math.abs(lon).toFixed(4)}° {lon >= 0 ? 'E' : 'W'}
            </div>
          </div>

          <div style={divider} />

          {/* Zoom */}
          <div style={section}>
            <div style={sectionLabel}>ZOOM</div>
            <div style={{ ...monoValue, color: '#7eb8ff' }}>
              {zoom.toFixed(1)}
            </div>
            <div style={zoomBar}>
              <div
                style={{
                  ...zoomFill,
                  width: `${Math.min(100, (zoom / 25) * 100)}%`,
                }}
              />
            </div>
          </div>

          <div style={divider} />

          {/* Active layers */}
          <div style={section}>
            <div style={sectionLabel}>LAYERS</div>
            {layerRows.map(({ key, label, icon }) => (
              <div key={key} style={layerRow}>
                <span style={{ ...dot, color: activeLayers[key] ? '#3c82ff' : 'rgba(255,255,255,0.2)' }}>●</span>
                <span style={{ ...layerLabel, opacity: activeLayers[key] ? 1 : 0.35 }}>
                  {icon} {label}
                </span>
              </div>
            ))}
          </div>

          <div style={divider} />

          {/* Data badge */}
          <div style={badge}>
            <span style={{ color: '#3c82ff', fontWeight: 700 }}>●</span> LIVE
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 180,
  background: 'rgba(8,12,30,0.82)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(80,160,255,0.18)',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  zIndex: 10,
};

const content: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  animation: 'fadeIn 0.3s ease-out',
};

const collapseBtn: React.CSSProperties = {
  alignSelf: 'flex-end',
  background: 'none',
  border: 'none',
  color: 'rgba(150,200,255,0.6)',
  cursor: 'pointer',
  fontSize: '0.7rem',
  padding: '2px 4px',
  marginBottom: 6,
};

const section: React.CSSProperties = {
  padding: '8px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const sectionLabel: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'rgba(150,200,255,0.5)',
  marginBottom: 2,
};

const monoValue: React.CSSProperties = {
  fontSize: '0.78rem',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  color: 'rgba(255,255,255,0.9)',
  letterSpacing: '0.04em',
};

const divider: React.CSSProperties = {
  height: 1,
  background: 'rgba(80,160,255,0.1)',
  margin: '2px 0',
};

const zoomBar: React.CSSProperties = {
  marginTop: 4,
  height: 3,
  background: 'rgba(80,160,255,0.15)',
  borderRadius: 2,
  overflow: 'hidden',
};

const zoomFill: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #1a4acc, #3c82ff)',
  borderRadius: 2,
  transition: 'width 0.3s ease',
};

const layerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
};

const dot: React.CSSProperties = {
  fontSize: '0.45rem',
  lineHeight: 1,
  transition: 'color 0.2s',
};

const layerLabel: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'rgba(255,255,255,0.8)',
  transition: 'opacity 0.2s',
};

const badge: React.CSSProperties = {
  marginTop: 4,
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'rgba(150,200,255,0.5)',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
};
