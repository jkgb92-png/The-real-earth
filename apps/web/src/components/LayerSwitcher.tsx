'use client';

/**
 * apps/web/src/components/LayerSwitcher.tsx
 *
 * Segmented three-pill control for selecting the active base satellite layer:
 *  🌍 Standard RGB  —  high-res Sentinel-2 composite (@2x)
 *  🌿 Vegetation (NDVI)  —  colourised (NIR−Red)/(NIR+Red) health index
 *  📡 Cloud-Piercing (SAR)  —  Sentinel-1 grayscale backscatter
 *
 * Placed in the top-centre of the map so it doesn't overlap the LayerDock.
 */

import React from 'react';

export type BaseLayerId = 'rgb' | 'ndvi' | 'sar';

interface LayerPill {
  id: BaseLayerId;
  label: string;
  icon: string;
  activeColor: string;
}

const PILLS: LayerPill[] = [
  { id: 'rgb',  label: 'RGB',  icon: '🌍', activeColor: '#f59e0b' },
  { id: 'ndvi', label: 'NDVI', icon: '🌿', activeColor: '#4ade80' },
  { id: 'sar',  label: 'SAR',  icon: '📡', activeColor: '#94a3b8' },
];

interface Props {
  activeLayer: BaseLayerId;
  onLayerChange: (id: BaseLayerId) => void;
}

export function LayerSwitcher({ activeLayer, onLayerChange }: Props) {
  return (
    <div style={container}>
      {PILLS.map(({ id, label, icon, activeColor }) => {
        const isActive = id === activeLayer;
        return (
          <button
            key={id}
            type="button"
            style={{
              ...pill,
              ...(isActive ? pillActive(activeColor) : {}),
            }}
            onClick={() => onLayerChange(id)}
            title={`Switch to ${label} layer`}
          >
            <span style={pillIcon}>{icon}</span>
            <span style={{ ...pillLabel, ...(isActive ? { color: activeColor } : {}) }}>
              {label}
            </span>
            {isActive && (
              <span style={{ ...activeDot, background: activeColor }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'row',
  gap: 4,
  zIndex: 10,
  animation: 'slideInLeft 0.5s cubic-bezier(0.22,1,0.36,1) 0.8s both',
};

const pill: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  paddingInline: 12,
  paddingBlock: 7,
  background: 'rgba(8,12,30,0.82)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(80,160,255,0.18)',
  borderRadius: 22,
  cursor: 'pointer',
  transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
  color: 'rgba(150,200,255,0.7)',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  fontFamily: 'ui-monospace, monospace',
  whiteSpace: 'nowrap',
};

function pillActive(color: string): React.CSSProperties {
  return {
    borderColor: color,
    background: `rgba(${hexToRgb(color)}, 0.14)`,
    boxShadow: `0 0 10px 2px rgba(${hexToRgb(color)}, 0.22)`,
  };
}

const pillIcon: React.CSSProperties = {
  fontSize: '0.85rem',
  lineHeight: 1,
};

const pillLabel: React.CSSProperties = {
  color: 'rgba(150,200,255,0.7)',
  transition: 'color 0.2s',
};

const activeDot: React.CSSProperties = {
  position: 'absolute',
  top: 5,
  right: 5,
  width: 5,
  height: 5,
  borderRadius: '50%',
  animation: 'glowPulse 1.5s ease-in-out infinite',
};

function hexToRgb(hex: string): string {
  const map: Record<string, string> = {
    '#f59e0b': '245,158,11',
    '#4ade80': '74,222,128',
    '#94a3b8': '148,163,184',
  };
  return map[hex] ?? '80,160,255';
}
