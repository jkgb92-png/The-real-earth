/**
 * apps/mobile/src/components/LayerSheet.tsx
 *
 * Bottom-sheet style layer control panel for the mobile app.
 *
 * Activated by long-pressing the map or tapping the "Layers" button.
 * Provides the same layer toggles as the web HUDPanel + LayerDock.
 *
 * Built with React Native's built-in Animated API (no extra dependencies).
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface LayerState {
  clouds: boolean;
  terminator: boolean;
  iss: boolean;
  sentinel: boolean;
}

interface Props {
  visible: boolean;
  layers: LayerState;
  onToggle: (key: keyof LayerState) => void;
  onClose: () => void;
}

const SHEET_HEIGHT = 320;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const LAYER_ITEMS: Array<{
  key: keyof LayerState;
  label: string;
  icon: string;
  description: string;
  activeColor: string;
}> = [
  { key: 'sentinel',   icon: '📡', label: 'Sentinel-2',   description: 'High-res cloud-free overlay (z≥10)',  activeColor: '#f59e0b' },
  { key: 'terminator', icon: '🌙', label: 'Day / Night',   description: 'Real-time day/night terminator',      activeColor: '#a78bfa' },
  { key: 'clouds',     icon: '☁️',  label: 'Live Clouds',   description: 'OpenWeatherMap cloud tiles',          activeColor: '#6dd5fa' },
  { key: 'iss',        icon: '🛰',  label: 'ISS Tracker',   description: 'Live ISS position & trail',          activeColor: '#34d399' },
];

export function LayerSheet({ visible, layers, onToggle, onClose }: Props): React.ReactElement {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : SHEET_HEIGHT,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [visible, slideAnim]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        <Text style={styles.title}>Map Layers</Text>

        {LAYER_ITEMS.map(({ key, icon, label, description, activeColor }) => {
          const isActive = layers[key];
          return (
            <TouchableOpacity
              key={key}
              style={[styles.row, isActive && { borderColor: activeColor + '55' }]}
              onPress={() => onToggle(key)}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowIcon}>{icon}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, isActive && { color: activeColor }]}>
                    {label}
                  </Text>
                  <Text style={styles.rowDesc}>{description}</Text>
                </View>
              </View>

              {/* Toggle pill */}
              <View
                style={[
                  styles.toggle,
                  isActive && { backgroundColor: activeColor, borderColor: activeColor },
                ]}
              >
                <Text style={[styles.toggleText, isActive && { color: '#0a0a1a' }]}>
                  {isActive ? 'ON' : 'OFF'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: '#0e1228',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(80,160,255,0.2)',
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,200,255,0.3)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    color: 'rgba(150,200,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(80,160,255,0.1)',
    padding: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rowIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
  rowDesc: {
    color: 'rgba(150,200,255,0.4)',
    fontSize: 11,
    marginTop: 1,
  },
  toggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
  },
  toggleText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
