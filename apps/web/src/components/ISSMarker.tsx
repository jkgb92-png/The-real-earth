'use client';

/**
 * apps/web/src/components/ISSMarker.tsx
 *
 * Fetches and displays the ISS live position on the Mapbox map.
 *
 * - Polls wheretheiss.at every 5 s (free, no API key required)
 * - Renders as an animated SVG pulsing ring via a Mapbox Marker
 * - Shows a tooltip card with altitude, speed, and UTC time
 *
 * The marker element is a plain DOM div injected by react-map-gl's <Marker>.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Marker } from 'react-map-gl';

const ISS_API = 'https://api.wheretheiss.at/v1/satellites/25544';
const POLL_INTERVAL_MS = 5000;

interface ISSPosition {
  latitude: number;
  longitude: number;
  altitude: number;   // km
  velocity: number;   // km/h
  timestamp: number;  // Unix seconds
}

interface Props {
  /** Set to false to hide the marker without unmounting (avoids fetch) */
  enabled: boolean;
}

export function ISSMarker({ enabled }: Props): React.ReactElement | null {
  const [position, setPosition] = useState<ISSPosition | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPosition = useCallback(async () => {
    try {
      const res = await fetch(ISS_API);
      if (!res.ok) return;
      const data = await res.json() as ISSPosition;
      setPosition(data);
    } catch {
      // Network errors are silently ignored; last known position stays visible
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    fetchPosition();
    intervalRef.current = setInterval(fetchPosition, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, fetchPosition]);

  if (!enabled || !position) return null;

  const utcTime = new Date(position.timestamp * 1000).toUTCString().slice(17, 25);

  return (
    <Marker
      longitude={position.longitude}
      latitude={position.latitude}
      anchor="center"
    >
      <div
        style={markerWrapper}
        onClick={() => setShowTooltip((v) => !v)}
        title="Click for ISS details"
      >
        {/* Pulsing rings */}
        <div style={{ ...ring, animationDelay: '0s' }} />
        <div style={{ ...ring, animationDelay: '0.6s', opacity: 0.5 }} />

        {/* Central dot */}
        <div style={centerDot} />

        {/* Tooltip */}
        {showTooltip && (
          <div style={tooltip}>
            <div style={tooltipTitle}>🛰 ISS</div>
            <div style={tooltipRow}>
              <span style={tooltipLabel}>ALT</span>
              <span style={tooltipValue}>{position.altitude.toFixed(0)} km</span>
            </div>
            <div style={tooltipRow}>
              <span style={tooltipLabel}>SPD</span>
              <span style={tooltipValue}>{position.velocity.toFixed(0)} km/h</span>
            </div>
            <div style={tooltipRow}>
              <span style={tooltipLabel}>UTC</span>
              <span style={tooltipValue}>{utcTime}</span>
            </div>
            <div style={tooltipRow}>
              <span style={tooltipLabel}>LAT</span>
              <span style={tooltipValue}>{position.latitude.toFixed(2)}°</span>
            </div>
            <div style={tooltipRow}>
              <span style={tooltipLabel}>LON</span>
              <span style={tooltipValue}>{position.longitude.toFixed(2)}°</span>
            </div>
          </div>
        )}
      </div>
    </Marker>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const markerWrapper: React.CSSProperties = {
  position: 'relative',
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const ring: React.CSSProperties = {
  position: 'absolute',
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: '2px solid rgba(52, 211, 153, 0.8)',
  animation: 'issRing 1.4s ease-out infinite',
};

const centerDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#34d399',
  boxShadow: '0 0 8px 2px rgba(52,211,153,0.7)',
  position: 'relative',
  zIndex: 1,
};

const tooltip: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 12px)',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(8,12,30,0.92)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(52,211,153,0.3)',
  borderRadius: 8,
  padding: '10px 14px',
  minWidth: 160,
  animation: 'fadeInScale 0.2s ease-out',
  zIndex: 20,
};

const tooltipTitle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#34d399',
  marginBottom: 6,
  letterSpacing: '0.06em',
};

const tooltipRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '2px 0',
};

const tooltipLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(150,200,255,0.5)',
};

const tooltipValue: React.CSSProperties = {
  fontSize: '0.72rem',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  color: 'rgba(255,255,255,0.9)',
};
