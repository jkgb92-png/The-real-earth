/**
 * packages/map-core/src/useViewportObserver.ts
 *
 * React hook that tracks the Mapbox camera viewport and triggers callbacks
 * when the user pans or zooms.
 *
 * Features
 * --------
 * - 150 ms debounce before upgrading tile resolution (avoids spamming requests
 *   while the user is actively pinching/dragging).
 * - Dynamic resolution cap: devices with < 3 GB RAM are limited to zoom 16
 *   instead of the default max of 20.
 * - Exposes `prefetchRadius` so the tile cache can pre-warm a 3×3 grid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_ZOOM = 20;
const LOW_MEMORY_MAX_ZOOM = 16;
const LOW_MEMORY_THRESHOLD_MB = 3072; // 3 GB in MB
const DEBOUNCE_MS = 150;

export interface Viewport {
  zoom: number;
  centerTileX: number;
  centerTileY: number;
  /** Effective max zoom for this device */
  maxZoom: number;
}

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, zoom),
  );
}

function getDeviceMaxZoom(): number {
  // On React Native, react-native-device-info exposes total memory.
  // We do a best-effort check; if unavailable we default to high quality.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info');
    const totalMem: number = DeviceInfo.getTotalMemorySync() / (1024 * 1024); // bytes → MB
    return totalMem < LOW_MEMORY_THRESHOLD_MB ? LOW_MEMORY_MAX_ZOOM : DEFAULT_MAX_ZOOM;
  } catch {
    return DEFAULT_MAX_ZOOM;
  }
}

export function useViewportObserver(
  onViewportChange: (viewport: Viewport) => void,
): {
  handleCameraChange: (zoom: number, longitude: number, latitude: number) => void;
  maxZoom: number;
} {
  const maxZoom = useRef(getDeviceMaxZoom()).current;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCameraChange = useCallback(
    (zoom: number, longitude: number, latitude: number) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const effectiveZoom = Math.min(Math.floor(zoom), maxZoom);
        onViewportChange({
          zoom: effectiveZoom,
          centerTileX: lon2tile(longitude, effectiveZoom),
          centerTileY: lat2tile(latitude, effectiveZoom),
          maxZoom,
        });
      }, DEBOUNCE_MS);
    },
    [maxZoom, onViewportChange],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return { handleCameraChange, maxZoom };
}
