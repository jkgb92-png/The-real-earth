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
}

interface Props {
  mode: 'map' | 'globe';
  layers: LayerState;
  onModeToggle: () => void;
  onLayerToggle: (key: keyof LayerState) => void;
}

const ITEMS: Array<{
  key: keyof LayerState | 'globe';
  icon: string;
  label: string;
  activeColor: string;
}> = [
  { key: 'clouds',     icon: '☁',  label: 'Live Clouds',      activeColor: '#6dd5fa' },
  { key: 'terminator', icon: '🌙', label: 'Day/Night',         activeColor: '#a78bfa' },
  { key: 'iss',        icon: '🛰', label: 'ISS Tracker',       activeColor: '#34d399' },
  { key: 'sentinel',   icon: '📡', label: 'Sentinel-2',        activeColor: '#f59e0b' },
];

export function LayerDock({ mode, layers, onModeToggle, onLayerToggle }: Props): React.ReactElement {
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
            <button
              key={key}
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
  };
  return map[hex] ?? '80,160,255';
}
