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

import React, { useEffect, useRef, useState } from 'react';

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

// ── Coordinate lead-in hook ───────────────────────────────────────────────────
/**
 * Manages the glitch-scroll coordinate display.
 * On each new coordinate update from the worker the digits spin briefly before
 * settling on the real value, giving the "tactical HUD acquiring lock" feel.
 */
function useGlitchCoords(lat: number, lon: number) {
  const [display, setDisplay] = useState({ lat, lon });
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Cancel any in-progress spin.
    if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; }

    let ticks = 0;
    const TOTAL = 8; // number of random frames before settling
    spinRef.current = setInterval(() => {
      ticks++;
      if (ticks >= TOTAL) {
        clearInterval(spinRef.current!);
        spinRef.current = null;
        setDisplay({ lat, lon });
      } else {
        // Random offset ±0.005° keeps the spinning digits plausible (sub-km range).
        setDisplay({
          lat: lat + (Math.random() - 0.5) * 0.01,
          lon: lon + (Math.random() - 0.5) * 0.01,
        });
      }
    }, 40);

    return () => {
      if (spinRef.current) clearInterval(spinRef.current);
    };
  }, [lat, lon]); // new spin whenever real coords change

  return display;
}

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

  // Raw coordinates from the worker — updated ~6 Hz via postMessage relay.
  const [rawCoords, setRawCoords] = useState({ lat: 26.6133, lon: -81.6317 });
  // Glitch-scroll display coordinates.
  const glitchCoords = useGlitchCoords(rawCoords.lat, rawCoords.lon);
  const anyActive = Object.values(state).some(Boolean);

  // Listen for worker messages relayed by globe.html.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'specOpsWorker' && msg.inner?.type === 'cameraCoords') {
        setRawCoords({ lat: msg.inner.lat, lon: msg.inner.lon });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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

  const fmtCoord = (n: number, pos: string, neg: string) => {
    const dir = n >= 0 ? pos : neg;
    return `${Math.abs(n).toFixed(4)}° ${dir}`;
  };

  return (
    <div style={toolbarStyle}>
      {/* Title bar */}
      <div style={titleRowStyle}>
        <span style={titleIconStyle}>⚔</span>
        <span style={titleTextStyle}>SPEC-OPS</span>
        {anyActive && <span style={liveIndicatorStyle}>LIVE</span>}
      </div>

      {/* Coordinate lead-in display */}
      <div style={coordRowStyle}>
        <span style={coordLabelStyle}>LAT</span>
        <span style={coordValueStyle}>{fmtCoord(glitchCoords.lat, 'N', 'S')}</span>
        <span style={coordSepStyle}>·</span>
        <span style={coordLabelStyle}>LON</span>
        <span style={coordValueStyle}>{fmtCoord(glitchCoords.lon, 'E', 'W')}</span>
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

// ── Coordinate lead-in display styles ─────────────────────────────────────────

const coordRowStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:            4,
  padding:        '3px 6px',
  background:     'rgba(0,255,180,0.06)',
  border:         '1px solid rgba(0,255,180,0.18)',
  borderRadius:   6,
  marginBottom:   2,
  fontFamily:     '"Courier New", Courier, monospace',
};

const coordLabelStyle: React.CSSProperties = {
  fontSize:      '0.45rem',
  fontWeight:    700,
  letterSpacing: '0.12em',
  color:         'rgba(0,255,180,0.5)',
};

const coordValueStyle: React.CSSProperties = {
  fontSize:      '0.55rem',
  fontWeight:    700,
  letterSpacing: '0.06em',
  color:         'rgba(0,255,180,0.9)',
  minWidth:      '6.8ch',
  textAlign:     'right' as const,
};

const coordSepStyle: React.CSSProperties = {
  fontSize: '0.5rem',
  color:    'rgba(0,255,180,0.25)',
  padding:  '0 2px',
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
