/**
 * apps/mobile/src/screens/HomeScreen.tsx
 *
 * Main screen — Mapbox native map with:
 *  - LayerSheet for toggling map layers (long-press or "Layers" button)
 *  - Mode toggle (map ↔ globe)
 *  - Haptic feedback on layer toggle and mode switch
 *  - Offline pack download modal
 */

import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EarthMapView, GlobeView, SwipeCompare } from '@the-real-earth/map-core';
import { OfflinePackModal } from '../components/OfflinePackModal';
import { LayerSheet, LayerState } from '../components/LayerSheet';

// Haptics — graceful degradation if expo-haptics is unavailable
let Haptics: { impactAsync: (style: string) => Promise<void>; ImpactFeedbackStyle: { Medium: string } } | null = null;
try {
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

function hapticImpact() {
  if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
}

const TILE_SERVER_URL = process.env.EXPO_PUBLIC_TILE_SERVER_URL ?? 'http://localhost:8000';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const CESIUM_TOKEN = process.env.EXPO_PUBLIC_CESIUM_ION_TOKEN ?? '';

export function HomeScreen(): React.ReactElement {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [swipeMode, setSwipeMode] = useState(false);
  const [layers, setLayers] = useState<LayerState>({
    sentinel: true,
    terminator: true,
    iss: true,
    clouds: false,
    ndvi: false,
    sar: false,
  });

  const toggleMode = useCallback(() => {
    hapticImpact();
    setMode((m) => (m === 'map' ? 'globe' : 'map'));
  }, []);

  const handleLayerToggle = useCallback((key: keyof LayerState) => {
    hapticImpact();
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Swipe Compare mode — full-screen, replaces normal map view */}
      {swipeMode ? (
        <SwipeCompare
          accessToken={MAPBOX_TOKEN}
          tileServerUrl={TILE_SERVER_URL}
          initialCenter={[0, 20]}
          initialZoom={3}
          historicalYear={2024}
          onClose={() => setSwipeMode(false)}
        />
      ) : mode === 'map' ? (
        <EarthMapView
          accessToken={MAPBOX_TOKEN}
          tileServerUrl={TILE_SERVER_URL}
          initialCenter={[0, 20]}
          initialZoom={2}
          activeLayer={layers.ndvi ? 'ndvi' : layers.sar ? 'sar' : 'rgb'}
        />
      ) : (
        <GlobeView tileServerUrl={TILE_SERVER_URL} cesiumIonToken={CESIUM_TOKEN} />
      )}

      {/* Top-right controls — only show when not in swipe mode */}
      {!swipeMode && (
      <View style={styles.controls}>
        {/* Mode toggle */}
        <Pressable
          style={[styles.button, mode === 'globe' && styles.buttonActive]}
          onPress={toggleMode}
        >
          <Text style={styles.buttonText}>
            {mode === 'map' ? '🌐 Globe' : '🗺️ Map'}
          </Text>
        </Pressable>

        {/* Layer controls */}
        <Pressable
          style={[styles.button, showLayers && styles.buttonActive]}
          onPress={() => setShowLayers(true)}
        >
          <Text style={styles.buttonText}>🗂 Layers</Text>
        </Pressable>

        {/* Time-Machine Swipe Compare */}
        <Pressable
          style={styles.button}
          onPress={() => { hapticImpact(); setSwipeMode(true); }}
        >
          <Text style={styles.buttonText}>⏳ Compare</Text>
        </Pressable>

        {/* Offline download */}
        <Pressable
          style={styles.button}
          onPress={() => setShowOfflineModal(true)}
        >
          <Text style={styles.buttonText}>⬇️ Offline</Text>
        </Pressable>
      </View>
      )}

      {/* Active layer indicator pills (bottom) — hidden in swipe mode */}
      {!swipeMode && (
      <View style={styles.layerPills}>
        {layers.sentinel   && <View style={[styles.pill, { borderColor: '#f59e0b44' }]}><Text style={[styles.pillText, { color: '#f59e0b' }]}>🌍 RGB</Text></View>}
        {layers.ndvi       && <View style={[styles.pill, { borderColor: '#4ade8044' }]}><Text style={[styles.pillText, { color: '#4ade80' }]}>🌿 NDVI</Text></View>}
        {layers.sar        && <View style={[styles.pill, { borderColor: '#94a3b844' }]}><Text style={[styles.pillText, { color: '#94a3b8' }]}>📡 SAR</Text></View>}
        {layers.terminator && <View style={[styles.pill, { borderColor: '#a78bfa44' }]}><Text style={[styles.pillText, { color: '#a78bfa' }]}>🌙 Day/Night</Text></View>}
        {layers.iss        && <View style={[styles.pill, { borderColor: '#34d39944' }]}><Text style={[styles.pillText, { color: '#34d399' }]}>🛰 ISS</Text></View>}
        {layers.clouds     && <View style={[styles.pill, { borderColor: '#6dd5fa44' }]}><Text style={[styles.pillText, { color: '#6dd5fa' }]}>☁ Clouds</Text></View>}
      </View>
      )}

      {/* Layer sheet */}
      <LayerSheet
        visible={showLayers}
        layers={layers}
        onToggle={handleLayerToggle}
        onClose={() => setShowLayers(false)}
      />

      {/* Offline modal */}
      {showOfflineModal && (
        <OfflinePackModal
          tileServerUrl={TILE_SERVER_URL}
          onClose={() => setShowOfflineModal(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  controls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 16,
    gap: 8,
  },
  button: {
    backgroundColor: 'rgba(8,12,30,0.82)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(80,160,255,0.2)',
  },
  buttonActive: {
    backgroundColor: 'rgba(60,130,255,0.18)',
    borderColor: 'rgba(60,130,255,0.5)',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  layerPills: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'rgba(8,12,30,0.72)',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
