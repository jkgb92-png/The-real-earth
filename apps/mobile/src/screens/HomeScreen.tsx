/**
 * apps/mobile/src/screens/HomeScreen.tsx
 *
 * Main screen — Mapbox native map with a floating button to toggle
 * the CesiumJS 3D Globe view.
 */

import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EarthMapView, GlobeView } from '@the-real-earth/map-core';
import { OfflinePackModal } from '../components/OfflinePackModal';

const TILE_SERVER_URL = process.env.EXPO_PUBLIC_TILE_SERVER_URL ?? 'http://localhost:8000';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
const CESIUM_TOKEN = process.env.EXPO_PUBLIC_CESIUM_ION_TOKEN ?? '';

export function HomeScreen(): React.ReactElement {
  const [mode, setMode] = useState<'map' | 'globe'>('map');
  const [showOfflineModal, setShowOfflineModal] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      {mode === 'map' ? (
        <EarthMapView
          accessToken={MAPBOX_TOKEN}
          tileServerUrl={TILE_SERVER_URL}
          initialCenter={[0, 20]}
          initialZoom={2}
        />
      ) : (
        <GlobeView tileServerUrl={TILE_SERVER_URL} cesiumIonToken={CESIUM_TOKEN} />
      )}

      {/* Mode toggle */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.button, mode === 'globe' && styles.buttonActive]}
          onPress={() => setMode((m) => (m === 'map' ? 'globe' : 'map'))}
        >
          <Text style={styles.buttonText}>
            {mode === 'map' ? '🌐 Globe' : '🗺️ Map'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.button}
          onPress={() => setShowOfflineModal(true)}
        >
          <Text style={styles.buttonText}>⬇️ Offline</Text>
        </Pressable>
      </View>

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
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  buttonActive: {
    backgroundColor: 'rgba(60,130,255,0.4)',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
