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
import { type BaseLayerId } from './layers';

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
  /**
   * Active base layer to display.
   *  'rgb'  → Sentinel-2 cloud-free composite (default)
   *  'ndvi' → Vegetation health (NIR/Red ratio, colourised)
   *  'sar'  → Cloud-piercing SAR backscatter (grayscale)
   */
  activeLayer?: BaseLayerId;
  /**
   * Optional historical year filter passed as a query parameter to the
   * Sentinel tile endpoint (e.g. 2024 for the Time-Machine Swipe Compare).
   * When undefined the latest composite is served.
   */
  year?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EarthMapView({
  accessToken,
  tileServerUrl,
  initialCenter = [0, 20],
  initialZoom = 2,
  activeLayer = 'rgb',
  year,
}: MapViewProps): React.ReactElement | null {
  const cacheRef = useRef<TileCache | null>(null);

  // Re-create the cache when the active layer changes so prefetch targets the
  // correct tile URL template.
  const cacheLayerRef = useRef<string | null>(null);
  const cacheLayerKey = `${activeLayer}:${year ?? ''}`;

  if (!cacheRef.current || cacheLayerRef.current !== cacheLayerKey) {
    cacheLayerRef.current = cacheLayerKey;
    const yearParam = year ? `?year=${year}` : '';
    let urlTemplate: string;
    switch (activeLayer) {
      case 'ndvi':
        urlTemplate = `${tileServerUrl}/tiles/ndvi/{z}/{x}/{y}`;
        break;
      case 'sar':
        urlTemplate = `${tileServerUrl}/tiles/sar/{z}/{x}/{y}`;
        break;
      default:
        urlTemplate = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}${yearParam}`;
    }
    cacheRef.current = new TileCache({
      tileUrlTemplate: urlTemplate,
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
  const esriUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  // Derive the overlay tile URL from the active layer and optional year filter.
  function buildOverlayUrl(): string {
    const yearParam = year ? `?year=${year}` : '';
    switch (activeLayer) {
      case 'ndvi':
        return `${tileServerUrl}/tiles/ndvi/{z}/{x}/{y}`;
      case 'sar':
        return `${tileServerUrl}/tiles/sar/{z}/{x}/{y}`;
      case 'rgb':
      default:
        return `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}${yearParam}`;
    }
  }

  const overlayUrl = buildOverlayUrl();

  // @2x / tileSize: RGB layer uses 512 px tiles (tileSize=512 on RN renders
  // them at half the CSS pixel width → pixel-perfect on Retina displays).
  // NDVI and SAR serve 256 px tiles.
  const overlayTileSize: 256 | 512 = activeLayer === 'rgb' ? 512 : 256;

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

      {/* Base layer: NASA GIBS Blue Marble (native tiles up to z=8) */}
      <RasterSource
        id="gibs-source"
        tileUrlTemplates={[gibsUrl]}
        tileSize={256}
        maxZoomLevel={8}
      >
        <RasterLayer
          id="gibs-layer"
          sourceID="gibs-source"
          maxZoomLevel={9}
          style={{ rasterOpacity: 1, rasterResampling: 'nearest' }}
        />
      </RasterSource>

      {/* Gap-fill: ESRI World Imagery (z ≥ 8, up to z=17).
          Starts at z=8 so there is no blur window between GIBS and Sentinel:
          Antarctica and other Sentinel-2-free areas stay sharp at any zoom.
          maxZoomLevel capped at 17 to match near-global ESRI coverage; above
          z=17, MapboxGL overzooms the z=17 tile (blurry but visible) rather
          than firing requests that 404 in open ocean and other sparse areas,
          which would leave blank hidden tiles on-screen. */}
      <RasterSource
        id="esri-source"
        tileUrlTemplates={[esriUrl]}
        tileSize={256}
        maxZoomLevel={17}
      >
        <RasterLayer
          id="esri-layer"
          sourceID="esri-source"
          minZoomLevel={8}
          style={{ rasterOpacity: 1, rasterResampling: 'nearest' }}
        />
      </RasterSource>

      {/* High-res overlay: active base layer (RGB / NDVI / SAR) */}
      <RasterSource
        id="overlay-source"
        tileUrlTemplates={[overlayUrl]}
        tileSize={overlayTileSize}
        minZoomLevel={activeLayer === 'sar' ? 6 : 10}
        maxZoomLevel={maxZoom}
      >
        <RasterLayer
          id="overlay-layer"
          sourceID="overlay-source"
          minZoomLevel={activeLayer === 'sar' ? 6 : 10}
          style={{ rasterOpacity: 1, rasterResampling: 'linear' }}
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
