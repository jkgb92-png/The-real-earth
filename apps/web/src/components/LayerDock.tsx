'use client';

/**
 * apps/web/src/components/LayerDock.tsx
 *
 * Expandable icon dock (bottom-left) for toggling map layers.
 *
 * Icons:
 *  🌐 Globe mode toggle
 *  ☁  Live Clouds
 *  🌙 Night/Day Terminator
 *  🛰  ISS Tracker
 *  📡 Sentinel-2 overlay
 */

import React, { useState } from 'react';

export interface LayerState {
  clouds: boolean;
  terminator: boolean;
  iss: boolean;
  sentinel: boolean;
  bathymetry: boolean;
  borders: boolean;
  labels: boolean;
  ndvi: boolean;
  sar: boolean;
  swipe: boolean;
  ir: boolean;
  terrain: boolean;
}

interface Props {
  mode: 'map' | 'globe';
  layers: LayerState;
  onModeToggle: () => void;
  onLayerToggle: (key: keyof LayerState) => void;
  irIntensity: number;
  onIRIntensityChange: (v: number) => void;
}

const ITEMS: Array<{
  key: keyof LayerState | 'globe';
  icon: string;
  label: string;
  activeColor: string;
}> = [
  { key: 'clouds',       icon: '☁',  label: 'Live Clouds',          activeColor: '#6dd5fa' },
  { key: 'terminator',   icon: '🌙', label: 'Day/Night',             activeColor: '#a78bfa' },
  { key: 'iss',          icon: '🛰', label: 'ISS Tracker',           activeColor: '#34d399' },
  { key: 'sentinel',     icon: '🌍', label: 'Sentinel-2 RGB',        activeColor: '#f59e0b' },
  { key: 'ndvi',         icon: '🌿', label: 'Vegetation (NDVI)',     activeColor: '#4ade80' },
  { key: 'sar',          icon: '📡', label: 'Cloud-Piercing (SAR)',  activeColor: '#94a3b8' },
  { key: 'swipe',        icon: '⏳', label: 'Time-Machine Compare',  activeColor: '#818cf8' },
  { key: 'bathymetry',   icon: '🌊', label: 'Bathymetry',            activeColor: '#22d3ee' },
  { key: 'borders',      icon: '🗺️', label: 'Borders',               activeColor: '#c084fc' },
  { key: 'labels',       icon: '🔤', label: 'Country Names',         activeColor: '#fb923c' },
  { key: 'ir',           icon: '🌡️', label: 'Infrared (IR)',         activeColor: '#ff6b35' },
  { key: 'terrain',      icon: '⛰️', label: 'Mountain View',         activeColor: '#a3855a' },
];

export function LayerDock({ mode, layers, onModeToggle, onLayerToggle, irIntensity, onIRIntensityChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{ ...dock, animation: 'slideInLeft 0.5s cubic-bezier(0.22,1,0.36,1) 1.2s both' }}
    >
      {/* Globe toggle (always visible) */}
      <button
        style={{ ...dockItem, ...(mode === 'globe' ? dockItemActive('#3c82ff') : {}) }}
        onClick={onModeToggle}
        title={mode === 'map' ? 'Switch to 3D Globe' : 'Switch to 2D Map'}
        type="button"
      >
        <span style={dockIcon}>{mode === 'map' ? '🌐' : '🗺️'}</span>
        {mode === 'globe' && <span style={{ ...activeDot, color: '#3c82ff' }} />}
      </button>

      {/* Expand / collapse handle */}
      <button
        style={expandHandle}
        onClick={() => setExpanded((prev) => !prev)}
        title={expanded ? 'Hide layers' : 'Show layers'}
        type="button"
      >
        <span style={{ ...dockIcon, fontSize: '0.55rem', color: 'rgba(150,200,255,0.6)' }}>
          {expanded ? '▼' : '▲'}
        </span>
      </button>

      {/* Layer items — shown when expanded */}
      {expanded &&
        ITEMS.map(({ key, icon, label, activeColor }, i) => {
          const isActive = key === 'globe' ? false : layers[key as keyof LayerState];
          return (
            <React.Fragment key={key}>
              <button
                style={{
                  ...dockItem,
                  ...(isActive ? dockItemActive(activeColor) : {}),
                  animation: `dockItemIn 0.25s ease-out ${i * 50}ms both`,
                }}
                onClick={() => onLayerToggle(key as keyof LayerState)}
                title={label}
                type="button"
              >
                <span style={dockIcon}>{icon}</span>
                {isActive && <span style={{ ...activeDot, color: activeColor }} />}
              </button>
              {/* IR intensity slider — shown inline when IR layer is active */}
              {key === 'ir' && isActive && (
                <div style={irSliderWrapper} title="IR Intensity">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={irIntensity}
                    onChange={(e) => onIRIntensityChange(parseFloat(e.target.value))}
                    style={irSlider}
                    aria-label="IR intensity"
                  />
                  <span style={irSliderLabel}>{Math.round(irIntensity * 100)}%</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const dock: React.CSSProperties = {
  position: 'absolute',
  bottom: 40,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  zIndex: 10,
};

const dockItem: React.CSSProperties = {
  position: 'relative',
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(8,12,30,0.82)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(80,160,255,0.18)',
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'border-color 0.2s, background 0.2s',
};

function dockItemActive(color: string): React.CSSProperties {
  return {
    borderColor: color,
    background: `rgba(${hexToRgbStr(color)}, 0.12)`,
    boxShadow: `0 0 12px 2px rgba(${hexToRgbStr(color)}, 0.25)`,
  };
}

const dockIcon: React.CSSProperties = {
  fontSize: '1.2rem',
  lineHeight: 1,
};

const activeDot: React.CSSProperties = {
  position: 'absolute',
  top: 5,
  right: 5,
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
  animation: 'glowPulse 1.5s ease-in-out infinite',
};

const expandHandle: React.CSSProperties = {
  width: 44,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(8,12,30,0.7)',
  border: '1px solid rgba(80,160,255,0.1)',
  borderRadius: 6,
  cursor: 'pointer',
};

/** Convert #rrggbb or named color to "r,g,b" string for rgba() usage. */
function hexToRgbStr(hex: string): string {
  const map: Record<string, string> = {
    '#3c82ff': '60,130,255',
    '#6dd5fa': '109,213,250',
    '#a78bfa': '167,139,250',
    '#34d399': '52,211,153',
    '#f59e0b': '245,158,11',
    '#4ade80': '74,222,128',
    '#94a3b8': '148,163,184',
    '#818cf8': '129,140,248',
    '#22d3ee': '34,211,238',
    '#c084fc': '192,132,252',
    '#fb923c': '251,146,60',
    '#ff6b35': '255,107,53',
    '#a3855a': '163,133,90',
  };
  return map[hex] ?? '80,160,255';
}

const irSliderWrapper: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  width: 44,
  padding: '4px 0',
};

const irSlider: React.CSSProperties = {
  width: 36,
  accentColor: '#ff6b35',
  cursor: 'pointer',
  writingMode: 'vertical-lr' as const,
  direction: 'rtl' as const,
  height: 60,
  appearance: 'slider-vertical' as never,
  WebkitAppearance: 'slider-vertical' as never,
};

const irSliderLabel: React.CSSProperties = {
  fontSize: '0.5rem',
  color: 'rgba(255,107,53,0.9)',
  fontFamily: 'ui-monospace, monospace',
  letterSpacing: '0.04em',
};
