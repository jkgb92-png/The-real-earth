/**
 * packages/map-core/src/MapView.tsx
 *
 * Platform-abstracted map component.
 *
 * On iOS / Android:
 *   Renders the native Mapbox SDK (@rnmapbox/maps) for 60 FPS Metal/Vulkan
 *   performance with full GPU tile caching.
 *
 * On Web:
 *   Falls back to a Mapbox GL JS WebView (handled by the web app directly).
 *
 * Layers
 * ------
 *  1. NASA GIBS Blue Marble (base, z ≤ 9)     → WMTS proxy /tiles/gibs/
 *  2. Sentinel-2 composite overlay (z ≥ 10)   → /tiles/sentinel/
 *
 * The component also wires up the viewport observer hook so prefetching
 * and resolution scaling happen automatically.
 */

import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { TileCache } from '@the-real-earth/tile-cache';
import { useViewportObserver } from './useViewportObserver';

// Conditional import — will be undefined on Web (react-native-web)
let MapboxGL: typeof import('@rnmapbox/maps') | undefined;
try {
  MapboxGL = require('@rnmapbox/maps');
} catch {
  MapboxGL = undefined;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MapViewProps {
  /** Mapbox public access token */
  accessToken: string;
  /** Backend tile server base URL */
  tileServerUrl: string;
  /** Initial center [longitude, latitude] */
  initialCenter?: [number, number];
  /** Initial zoom level */
  initialZoom?: number;
  /** Enable the CesiumJS 3D Globe mode (WebView) */
  globeMode?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EarthMapView({
  accessToken,
  tileServerUrl,
  initialCenter = [0, 20],
  initialZoom = 2,
}: MapViewProps): React.ReactElement | null {
  const cacheRef = useRef<TileCache | null>(null);

  if (!cacheRef.current) {
    cacheRef.current = new TileCache({
      tileUrlTemplate: `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}`,
      maxBytes: 500 * 1024 * 1024,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
    });
    cacheRef.current.open().catch(console.error);
  }

  const { handleCameraChange, maxZoom } = useViewportObserver(
    useCallback(({ zoom, centerTileX, centerTileY }) => {
      cacheRef.current?.prefetchAround(zoom, centerTileX, centerTileY);
    }, []),
  );

  if (!MapboxGL) {
    // Web fallback — the web app renders its own Mapbox GL JS component
    return null;
  }

  const { MapView, Camera, RasterSource, RasterLayer } = MapboxGL;

  MapboxGL.setAccessToken(accessToken);

  const gibsUrl = `${tileServerUrl}/tiles/gibs/{z}/{x}/{y}.jpg`;
  const sentinelUrl = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}`;

  return (
    <MapView
      style={styles.map}
      onCameraChanged={(state) => {
        handleCameraChange(
          state.properties.zoom,
          state.properties.center[0],
          state.properties.center[1],
        );
      }}
    >
      <Camera
        defaultSettings={{
          centerCoordinate: initialCenter,
          zoomLevel: initialZoom,
        }}
        maxZoomLevel={maxZoom}
      />

      {/* Base layer: NASA GIBS Blue Marble */}
      <RasterSource
        id="gibs-source"
        tileUrlTemplates={[gibsUrl]}
        tileSize={256}
        maxZoomLevel={8}
      >
        <RasterLayer
          id="gibs-layer"
          sourceID="gibs-source"
          maxZoomLevel={10}
          style={{ rasterOpacity: 1, rasterResampling: 'nearest' }}
        />
      </RasterSource>

      {/* High-res overlay: Sentinel-2 (cloud-free composite) */}
      <RasterSource
        id="sentinel-source"
        tileUrlTemplates={[sentinelUrl]}
        tileSize={256}
        minZoomLevel={10}
        maxZoomLevel={maxZoom}
      >
        <RasterLayer
          id="sentinel-layer"
          sourceID="sentinel-source"
          minZoomLevel={10}
          style={{ rasterOpacity: 1, rasterResampling: 'nearest' }}
        />
      </RasterSource>
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
