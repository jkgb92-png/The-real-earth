/**
 * packages/map-core/src/SwipeCompare.tsx
 *
 * Mobile "Time-Machine" Swipe Compare component.
 *
 * Renders two EarthMapView instances (historical 2024 left, current right)
 * stacked absolutely. The top (current) map is clipped to the right portion
 * determined by a draggable PanResponder handle.
 *
 * Usage
 * -----
 *   <SwipeCompare
 *     accessToken={token}
 *     tileServerUrl="https://your-tile-server"
 *     initialCenter={[0, 20]}
 *     initialZoom={3}
 *     onClose={() => setSwipeMode(false)}
 *   />
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSwipeCompare } from './useSwipeCompare';

// Conditional import — will be undefined on Web (react-native-web)
let MapboxGL: typeof import('@rnmapbox/maps') | undefined;
try {
  MapboxGL = require('@rnmapbox/maps');
} catch {
  MapboxGL = undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwipeCompareProps {
  /** Mapbox public access token */
  accessToken: string;
  /** Backend tile server base URL */
  tileServerUrl: string;
  /** Initial map center [longitude, latitude] */
  initialCenter?: [number, number];
  /** Initial zoom level */
  initialZoom?: number;
  /** Historical year for the left map (default: 2024) */
  historicalYear?: number;
  /** Callback when the user closes swipe mode */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SwipeCompare({
  accessToken,
  tileServerUrl,
  initialCenter = [0, 20],
  initialZoom = 3,
  historicalYear = 2024,
  onClose,
}: SwipeCompareProps): React.ReactElement | null {
  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  const { position, setPosition } = useSwipeCompare(50);

  // Track the animated handle X position for smooth dragging
  const handleX = useRef(new Animated.Value(SCREEN_WIDTH / 2)).current;
  const lastX = useRef(SCREEN_WIDTH / 2);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const newX = Math.max(0, Math.min(SCREEN_WIDTH, lastX.current + gestureState.dx));
        handleX.setValue(newX);
        setPosition((newX / SCREEN_WIDTH) * 100);
      },
      onPanResponderRelease: (_, gestureState) => {
        const newX = Math.max(0, Math.min(SCREEN_WIDTH, lastX.current + gestureState.dx));
        lastX.current = newX;
      },
    }),
  ).current;

  if (!MapboxGL) {
    // No native Mapbox — return null (web handles this separately)
    return null;
  }

  const { MapView, Camera, RasterSource, RasterLayer } = MapboxGL;
  MapboxGL.setAccessToken(accessToken);

  const gibsUrl = `${tileServerUrl}/tiles/gibs/{z}/{x}/{y}.jpg`;
  const esriUrl =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const historicalUrl = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}?year=${historicalYear}`;
  const currentUrl = `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}`;

  // Width of the current (right) map panel, animated by handle position
  const currentWidth = Animated.multiply(
    handleX,
    new Animated.Value(1),
  );

  // The percentage split (position) drives the current map's left inset
  const splitPct = position;

  return (
    <View style={styles.container}>
      {/* ── Historical map (left, always full-width behind) ── */}
      <View style={StyleSheet.absoluteFillObject}>
        <MapView style={styles.map}>
          <Camera
            defaultSettings={{
              centerCoordinate: initialCenter,
              zoomLevel: initialZoom,
            }}
          />
          <RasterSource id="h-gibs" tileUrlTemplates={[gibsUrl]} tileSize={256} maxZoomLevel={8}>
            <RasterLayer id="h-gibs-layer" sourceID="h-gibs" maxZoomLevel={9}
              style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
          </RasterSource>
          <RasterSource id="h-esri" tileUrlTemplates={[esriUrl]} tileSize={256} maxZoomLevel={19}>
            <RasterLayer id="h-esri-layer" sourceID="h-esri" minZoomLevel={8}
              style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
          </RasterSource>
          <RasterSource id="h-sentinel" tileUrlTemplates={[historicalUrl]} tileSize={256} minZoomLevel={10}>
            <RasterLayer id="h-sentinel-layer" sourceID="h-sentinel" minZoomLevel={10}
              style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
          </RasterSource>
        </MapView>
      </View>

      {/* ── Current map (right, clipped to right portion) ── */}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { left: `${splitPct}%` as unknown as number, overflow: 'hidden' },
        ]}
      >
        <View style={{ width: SCREEN_WIDTH, position: 'absolute', top: 0, bottom: 0, right: 0 }}>
          <MapView style={styles.map}>
            <Camera
              defaultSettings={{
                centerCoordinate: initialCenter,
                zoomLevel: initialZoom,
              }}
            />
            <RasterSource id="c-gibs" tileUrlTemplates={[gibsUrl]} tileSize={256} maxZoomLevel={8}>
              <RasterLayer id="c-gibs-layer" sourceID="c-gibs" maxZoomLevel={9}
                style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
            </RasterSource>
            <RasterSource id="c-esri" tileUrlTemplates={[esriUrl]} tileSize={256} maxZoomLevel={19}>
              <RasterLayer id="c-esri-layer" sourceID="c-esri" minZoomLevel={8}
                style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
            </RasterSource>
            <RasterSource id="c-sentinel" tileUrlTemplates={[currentUrl]} tileSize={256} minZoomLevel={10}>
              <RasterLayer id="c-sentinel-layer" sourceID="c-sentinel" minZoomLevel={10}
                style={{ rasterOpacity: 1, rasterResampling: 'nearest' }} />
            </RasterSource>
          </MapView>
        </View>
      </View>

      {/* ── Draggable divider handle ── */}
      <Animated.View
        style={[styles.handle, { left: handleX }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.handleBar} />
        <View style={styles.handleKnob}>
          <Text style={styles.handleArrows}>◀ ▶</Text>
        </View>
        <View style={styles.handleBar} />
      </Animated.View>

      {/* ── Year labels ── */}
      <View style={styles.labelLeft} pointerEvents="none">
        <Text style={styles.labelText}>{historicalYear}</Text>
      </View>
      <View style={styles.labelRight} pointerEvents="none">
        <Text style={styles.labelText}>2026</Text>
      </View>

      {/* ── Close button ── */}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeText}>✕ Exit Compare</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 44,
    marginLeft: -22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  handleBar: {
    flex: 1,
    width: 3,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  handleKnob: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(8,12,30,0.9)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleArrows: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -1,
  },
  labelLeft: {
    position: 'absolute',
    top: 56,
    left: 16,
    backgroundColor: 'rgba(8,12,30,0.82)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(80,160,255,0.25)',
  },
  labelRight: {
    position: 'absolute',
    top: 56,
    right: 16,
    backgroundColor: 'rgba(8,12,30,0.82)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(60,130,255,0.4)',
  },
  labelText: {
    color: 'rgba(150,200,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(8,12,30,0.9)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(80,160,255,0.3)',
  },
  closeText: {
    color: 'rgba(150,200,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
  },
});
