'use client';

/**
 * apps/web/src/components/SpecOpsToolbar.tsx
 *
 * Glassmorphism HUD toolbar for the Spec-Ops Digital Twin mode.
 * Positioned at the top-centre of the globe view.
 *
 * Each button:
 *  1. Tracks its own active/inactive state locally.
 *  2. Sends a postMessage to the `globe.html` iframe so the
 *     spec-ops-worker.js can activate / deactivate the feature.
 *  3. Calls the optional `onToggle` callback so parent components
 *     (EarthWebMap → HUDPanel) can reflect the active state.
 *
 * The toolbar is self-contained: it owns no Three.js state.  All heavy
 * rendering happens in the worker; this component is purely declarative UI.
 */

import React, { useState } from 'react';

export type SpecOpsFeature = 'subsurface' | 'heroAsset' | 'scanner' | 'livePulse';

export interface SpecOpsState {
  subsurface: boolean;
  heroAsset:  boolean;
  scanner:    boolean;
  livePulse:  boolean;
}

interface FeatureMeta {
  key:    SpecOpsFeature;
  label:  string;
  icon:   string;
  color:  string;
  hint:   string;
}

const FEATURES: FeatureMeta[] = [
  {
    key:   'subsurface',
    label: 'SUBSURFACE',
    icon:  '🔬',
    color: '#00ffcc',
    hint:  'Clip terrain at Y=0 and reveal subsurface utility voxels',
  },
  {
    key:   'heroAsset',
    label: 'HERO ASSET',
    icon:  '✨',
    color: '#b060ff',
    hint:  'Cross-fade to Gaussian Splat model when camera < 100 m from hero coord',
  },
  {
    key:   'scanner',
    label: 'SCANNER',
    icon:  '📡',
    color: '#ffd700',
    hint:  'Radial Sobel scanner — Solar-Gold edge highlight (3 passes)',
  },
  {
    key:   'livePulse',
    label: 'LIVE PULSE',
    icon:  '⚡',
    color: '#00e5ff',
    hint:  'Animated flow pulses over Lehigh road network (mock data stream)',
  },
];

interface Props {
  /** Ref to the globe.html iframe — used to postMessage into the iframe. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Optional callback fired when any feature is toggled. */
  onToggle?: (feature: SpecOpsFeature, enabled: boolean) => void;
}

export function SpecOpsToolbar({ iframeRef, onToggle }: Props) {
  const [state, setState] = useState<SpecOpsState>({
    subsurface: false,
    heroAsset:  false,
    scanner:    false,
    livePulse:  false,
  });

  function toggle(key: SpecOpsFeature) {
    const enabled = !state[key];

    setState((prev) => ({ ...prev, [key]: enabled }));

    // Forward to the spec-ops-worker.js via globe.html's message relay.
    // Use the iframe's origin if available; fall back to '*' for same-origin
    // and GitHub Pages deployments where the exact origin may vary.
    const targetOrigin =
      iframeRef.current?.contentWindow?.location.origin ?? window.location.origin;

    iframeRef.current?.contentWindow?.postMessage(
      { type: 'specOps', feature: key, enabled },
      targetOrigin
    );

    onToggle?.(key, enabled);
  }

  const anyActive = Object.values(state).some(Boolean);

  return (
    <div style={toolbarStyle}>
      {/* Title bar */}
      <div style={titleRowStyle}>
        <span style={titleIconStyle}>⚔</span>
        <span style={titleTextStyle}>SPEC-OPS</span>
        {anyActive && <span style={liveIndicatorStyle}>LIVE</span>}
      </div>

      {/* Feature buttons */}
      <div style={buttonRowStyle}>
        {FEATURES.map(({ key, label, icon, color, hint }) => {
          const active = state[key];
          return (
            <button
              key={key}
              type="button"
              title={hint}
              style={buttonStyle(active, color)}
              onClick={() => toggle(key)}
            >
              <span style={btnIconStyle}>{icon}</span>
              <span style={btnLabelStyle(active)}>{label}</span>
              {active && <span style={activeDotStyle(color)} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const toolbarStyle: React.CSSProperties = {
  position:            'absolute',
  top:                 12,
  left:                '50%',
  transform:           'translateX(-50%)',
  display:             'flex',
  flexDirection:       'column',
  alignItems:          'center',
  gap:                 6,
  background:          'rgba(5, 10, 28, 0.82)',
  backdropFilter:      'blur(14px)',
  WebkitBackdropFilter:'blur(14px)',
  border:              '1px solid rgba(80,160,255,0.2)',
  borderRadius:        12,
  padding:             '8px 12px',
  zIndex:              20,
  pointerEvents:       'auto',
  userSelect:          'none',
};

const titleRowStyle: React.CSSProperties = {
  display:     'flex',
  alignItems:  'center',
  gap:         6,
  marginBottom: 2,
};

const titleIconStyle: React.CSSProperties = {
  fontSize: '0.85rem',
};

const titleTextStyle: React.CSSProperties = {
  fontSize:      '0.6rem',
  fontWeight:    700,
  letterSpacing: '0.2em',
  color:         'rgba(150,200,255,0.6)',
};

const liveIndicatorStyle: React.CSSProperties = {
  fontSize:      '0.5rem',
  fontWeight:    700,
  letterSpacing: '0.12em',
  color:         '#ff4466',
  background:    'rgba(255,40,70,0.15)',
  border:        '1px solid rgba(255,40,70,0.35)',
  borderRadius:  4,
  padding:       '1px 5px',
  animation:     'pulse 1.4s ease-in-out infinite',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap:     6,
};

function buttonStyle(active: boolean, color: string): React.CSSProperties {
  return {
    display:         'flex',
    flexDirection:   'column',
    alignItems:      'center',
    gap:             3,
    padding:         '6px 10px',
    background:      active
      ? `rgba(${hexToRgb(color)}, 0.15)`
      : 'rgba(255,255,255,0.04)',
    border:          active
      ? `1px solid rgba(${hexToRgb(color)}, 0.55)`
      : '1px solid rgba(255,255,255,0.1)',
    borderRadius:    8,
    cursor:          'pointer',
    transition:      'all 0.2s ease',
    minWidth:        62,
    position:        'relative',
  };
}

const btnIconStyle: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1,
};

function btnLabelStyle(active: boolean): React.CSSProperties {
  return {
    fontSize:      '0.5rem',
    fontWeight:    700,
    letterSpacing: '0.12em',
    color:         active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)',
    transition:    'color 0.2s',
    whiteSpace:    'nowrap',
  };
}

function activeDotStyle(color: string): React.CSSProperties {
  return {
    position:    'absolute',
    top:         4,
    right:       4,
    width:       5,
    height:      5,
    borderRadius:'50%',
    background:  color,
    boxShadow:   `0 0 6px ${color}`,
  };
}

/** Convert 6-digit hex colour to "r,g,b" for use in rgba(). */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
