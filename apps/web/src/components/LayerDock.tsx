'use client';

/**
 * apps/web/src/components/LayerDock.tsx
 *
 * Expandable icon dock (bottom-left) for toggling map layers.
 * All icons are inline SVG for consistent cross-platform rendering with
 * per-layer colour tints, hover glow, and active scale transforms.
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
  hero: boolean;
}

interface Props {
  mode: 'map' | 'globe';
  layers: LayerState;
  onModeToggle: () => void;
  onLayerToggle: (key: keyof LayerState) => void;
  irIntensity: number;
  onIRIntensityChange: (v: number) => void;
}

// ── SVG icon components ──────────────────────────────────────────────────────

function IconCloud({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M5 13a4 4 0 01-.5-7.95A5.5 5.5 0 0116 8.5a3 3 0 010 4.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M7 16l1.5-2M10 17l1-2.5M13 16l.5-2" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.75"/>
    </svg>
  );
}

function IconCrescent({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M14 10a6 6 0 01-8 5.65A6 6 0 1014 10z" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
      <circle cx="14.5" cy="5.5" r="1.5" fill={color} opacity="0.8"/>
    </svg>
  );
}

function IconSatellite({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="9" y="8" width="2" height="4" rx="0.5" stroke={color} strokeWidth="1.3"/>
      <rect x="4" y="9.5" width="4" height="1" rx="0.5" fill={color} opacity="0.8"/>
      <rect x="12" y="9.5" width="4" height="1" rx="0.5" fill={color} opacity="0.8"/>
      <circle cx="10" cy="10" r="1" fill={color}/>
      <path d="M13 7l1-1.5M7 7L6 5.5" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

function IconGlobe({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke={color} strokeWidth="1.4"/>
      <ellipse cx="10" cy="10" rx="3" ry="7" stroke={color} strokeWidth="1.2"/>
      <path d="M3 10h14M10 3a8 8 0 010 14" stroke={color} strokeWidth="1.1" opacity="0.7"/>
    </svg>
  );
}

function IconLeaf({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 16C10 16 4 13 4 7c0 0 4-2 8 0s5 6 3 10" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 16c0-3 2-6 5-8" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

function IconRadar({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 14a4 4 0 000-8" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M6.5 17A8 8 0 0113.5 3" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
      <path d="M4 10h2M14 10h2" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
      <circle cx="10" cy="10" r="1.5" fill={color}/>
      <path d="M10 10l4-4" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function IconClock({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke={color} strokeWidth="1.4"/>
      <path d="M10 7v3l2.5 1.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 6L2 4M4.5 14L3 16" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.65"/>
    </svg>
  );
}

function IconWave({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M2 10c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 1.5 3 2.5 3" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M2 14c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.55"/>
    </svg>
  );
}

function IconGrid({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <polygon points="10,3 17,7 17,13 10,17 3,13 3,7" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
      <line x1="10" y1="3" x2="10" y2="17" stroke={color} strokeWidth="1.1" opacity="0.6"/>
      <line x1="3" y1="7" x2="17" y2="13" stroke={color} strokeWidth="1.1" opacity="0.6"/>
      <line x1="3" y1="13" x2="17" y2="7" stroke={color} strokeWidth="1.1" opacity="0.6"/>
    </svg>
  );
}

function IconText({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <text x="5" y="15" fontFamily="Georgia,serif" fontSize="13" fontWeight="bold" fill={color}>A</text>
      <line x1="4" y1="16.5" x2="16" y2="16.5" stroke={color} strokeWidth="1.2" opacity="0.5"/>
    </svg>
  );
}

function IconThermometer({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="9" y="4" width="2" height="9" rx="1" stroke={color} strokeWidth="1.3"/>
      <circle cx="10" cy="14.5" r="2.5" stroke={color} strokeWidth="1.3"/>
      <line x1="12" y1="7" x2="13.5" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
      <line x1="12" y1="9.5" x2="13.5" y2="9.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

function IconMountain({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M2 16L8 7l3 3 4-6 3 6H2z" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M8 7l1 1.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.7"/>
      <path d="M6.5 9L4 16" stroke={color} strokeWidth="1" opacity="0.45"/>
    </svg>
  );
}

function IconFilm({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="5" width="14" height="10" rx="1.5" stroke={color} strokeWidth="1.4"/>
      <path d="M7 5v10M13 5v10" stroke={color} strokeWidth="1.2" opacity="0.6"/>
      <path d="M3 8h2M15 8h2M3 12h2M15 12h2" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.7"/>
      <path d="M9 9l3 1.5-3 1.5V9z" fill={color} opacity="0.85"/>
    </svg>
  );
}

function IconMapView({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3 5l5-2 4 2 5-2v12l-5 2-4-2-5 2V5z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M8 3v12M12 5v12" stroke={color} strokeWidth="1.1" opacity="0.55"/>
    </svg>
  );
}

function IconGlobeToggle({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.5"/>
      <ellipse cx="10" cy="10" rx="3.5" ry="7.5" stroke={color} strokeWidth="1.2" opacity="0.75"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10" stroke={color} strokeWidth="1.1" opacity="0.6"/>
      <line x1="4.5" y1="6" x2="15.5" y2="6" stroke={color} strokeWidth="1" opacity="0.4"/>
      <line x1="4.5" y1="14" x2="15.5" y2="14" stroke={color} strokeWidth="1" opacity="0.4"/>
    </svg>
  );
}

// ── Layer item definitions ────────────────────────────────────────────────────

type IconName =
  | 'clouds' | 'terminator' | 'iss' | 'sentinel' | 'ndvi' | 'sar'
  | 'swipe' | 'bathymetry' | 'borders' | 'labels' | 'ir' | 'terrain' | 'hero';

function LayerIcon({ name, color }: { name: IconName; color: string }) {
  switch (name) {
    case 'clouds':     return <IconCloud color={color} />;
    case 'terminator': return <IconCrescent color={color} />;
    case 'iss':        return <IconSatellite color={color} />;
    case 'sentinel':   return <IconGlobe color={color} />;
    case 'ndvi':       return <IconLeaf color={color} />;
    case 'sar':        return <IconRadar color={color} />;
    case 'swipe':      return <IconClock color={color} />;
    case 'bathymetry': return <IconWave color={color} />;
    case 'borders':    return <IconGrid color={color} />;
    case 'labels':     return <IconText color={color} />;
    case 'ir':         return <IconThermometer color={color} />;
    case 'terrain':    return <IconMountain color={color} />;
    case 'hero':       return <IconFilm color={color} />;
    default:           return null;
  }
}

const ITEMS: Array<{
  key: keyof LayerState;
  name: IconName;
  label: string;
  activeColor: string;
}> = [
  { key: 'clouds',     name: 'clouds',     label: 'Live Clouds',          activeColor: '#6dd5fa' },
  { key: 'terminator', name: 'terminator', label: 'Day/Night',             activeColor: '#a78bfa' },
  { key: 'iss',        name: 'iss',        label: 'ISS Tracker',           activeColor: '#34d399' },
  { key: 'sentinel',   name: 'sentinel',   label: 'Sentinel-2 RGB',        activeColor: '#f59e0b' },
  { key: 'ndvi',       name: 'ndvi',       label: 'Vegetation (NDVI)',     activeColor: '#4ade80' },
  { key: 'sar',        name: 'sar',        label: 'Cloud-Piercing (SAR)',  activeColor: '#94a3b8' },
  { key: 'swipe',      name: 'swipe',      label: 'Time-Machine Compare',  activeColor: '#818cf8' },
  { key: 'bathymetry', name: 'bathymetry', label: 'Bathymetry',            activeColor: '#22d3ee' },
  { key: 'borders',    name: 'borders',    label: 'Borders',               activeColor: '#c084fc' },
  { key: 'labels',     name: 'labels',     label: 'Country Names',         activeColor: '#fb923c' },
  { key: 'ir',         name: 'ir',         label: 'Infrared (IR)',         activeColor: '#ff6b35' },
  { key: 'terrain',    name: 'terrain',    label: 'Mountain View',         activeColor: '#a3855a' },
  { key: 'hero',       name: 'hero',       label: 'Hero Mode',             activeColor: '#f0c040' },
];

export function LayerDock({ mode, layers, onModeToggle, onLayerToggle, irIntensity, onIRIntensityChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div
      style={{ ...dock, animation: 'slideInLeft 0.5s cubic-bezier(0.22,1,0.36,1) 1.2s both' }}
    >
      {/* Globe toggle (always visible) */}
      <button
        style={{
          ...dockItem,
          ...(mode === 'globe' ? dockItemActive('#3c82ff') : {}),
          ...(hoveredKey === '__globe' ? dockItemHover('#3c82ff') : {}),
          transform: hoveredKey === '__globe' ? 'scale(1.08)' : undefined,
        }}
        onClick={onModeToggle}
        onMouseEnter={() => setHoveredKey('__globe')}
        onMouseLeave={() => setHoveredKey(null)}
        title={mode === 'map' ? 'Switch to 3D Globe' : 'Switch to 2D Map'}
        type="button"
      >
        <IconGlobeToggle color={mode === 'globe' ? '#3c82ff' : 'rgba(150,200,255,0.75)'} />
        {mode === 'globe' && <span style={{ ...activeDot, color: '#3c82ff' }} />}
      </button>

      {/* Expand / collapse handle */}
      <button
        style={expandHandle}
        onClick={() => setExpanded((prev) => !prev)}
        title={expanded ? 'Hide layers' : 'Show layers'}
        type="button"
      >
        <span style={{ fontSize: '0.55rem', color: 'rgba(150,200,255,0.6)', lineHeight: 1 }}>
          {expanded ? '▼' : '▲'}
        </span>
      </button>

      {/* Layer items — shown when expanded */}
      {expanded &&
        ITEMS.map(({ key, name, label, activeColor }, i) => {
          const isActive = layers[key];
          const isHovered = hoveredKey === key;
          return (
            <React.Fragment key={key}>
              <div style={{ position: 'relative' }}>
                <button
                  style={{
                    ...dockItem,
                    ...(isActive ? dockItemActive(activeColor) : {}),
                    ...(isHovered && !isActive ? dockItemHover(activeColor) : {}),
                    transform: isActive || isHovered ? 'scale(1.08)' : undefined,
                    animation: `dockItemIn 0.25s ease-out ${i * 50}ms both`,
                  }}
                  onClick={() => onLayerToggle(key)}
                  onMouseEnter={() => setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  title={label}
                  type="button"
                  aria-pressed={isActive}
                >
                  <LayerIcon name={name} color={isActive ? activeColor : isHovered ? activeColor : 'rgba(150,200,255,0.65)'} />
                  {isActive && <span style={{ ...activeDot, color: activeColor }} />}
                </button>
                {/* Tooltip label */}
                {isHovered && (
                  <div style={tooltip} role="tooltip">
                    {label}
                  </div>
                )}
              </div>
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
  transition: 'border-color 0.2s, background 0.2s, transform 0.15s, box-shadow 0.2s',
};

function dockItemActive(color: string): React.CSSProperties {
  return {
    borderColor: color,
    background: `rgba(${hexToRgbStr(color)}, 0.12)`,
    boxShadow: `0 0 12px 2px rgba(${hexToRgbStr(color)}, 0.28)`,
  };
}

function dockItemHover(color: string): React.CSSProperties {
  return {
    borderColor: `rgba(${hexToRgbStr(color)}, 0.55)`,
    background: `rgba(${hexToRgbStr(color)}, 0.07)`,
    boxShadow: `0 0 8px 1px rgba(${hexToRgbStr(color)}, 0.15)`,
  };
}

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

const tooltip: React.CSSProperties = {
  position: 'absolute',
  left: 52,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'rgba(8,12,30,0.92)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(80,160,255,0.22)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: '0.68rem',
  color: 'rgba(200,230,255,0.9)',
  fontFamily: 'system-ui, sans-serif',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 20,
  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
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
    '#f0c040': '240,192,64',
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
