/**
 * apps/mobile/src/components/OfflinePackModal.tsx
 *
 * Modal that lets users download a tile region for offline use.
 *
 * Flow:
 *  1. User long-presses the map (or taps the "Offline" button).
 *  2. This modal shows an estimate of tile count and storage required.
 *  3. On confirm → queue a background download job using Mapbox OfflineManager
 *     and expo-background-fetch.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface Props {
  tileServerUrl: string;
  onClose: () => void;
}

/** Estimate the number of tiles for a bounding box across a zoom range. */
function estimateTileCount(minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    // Rough global estimate: 4^z tiles at zoom z, but user typically views ~10%
    total += Math.pow(4, z) * 0.1;
  }
  return Math.round(total);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const TILE_BYTES_ESTIMATE = 15 * 1024; // ~15 KB per WebP tile
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

export function OfflinePackModal({ tileServerUrl, onClose }: Props): React.ReactElement {
  const [downloading, setDownloading] = useState(false);
  const [tileCount] = useState(() => estimateTileCount(MIN_ZOOM, MAX_ZOOM));
  const estimatedSize = tileCount * TILE_BYTES_ESTIMATE;

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    try {
      // In a real app: call Mapbox OfflineManager.createPack() with the current
      // viewport bounds, zoom range, and the Sentinel tile URL template.
      // Here we simulate the API call.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      onClose();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Download for Offline</Text>
          <Text style={styles.body}>
            Downloading zoom levels {MIN_ZOOM}–{MAX_ZOOM} for the current region.
          </Text>
          <Text style={styles.estimate}>
            ~{tileCount.toLocaleString()} tiles · {formatBytes(estimatedSize)}
          </Text>

          {downloading ? (
            <ActivityIndicator size="large" color="#3c82ff" style={styles.spinner} />
          ) : (
            <View style={styles.buttons}>
              <Pressable style={[styles.btn, styles.btnCancel]} onPress={onClose}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnConfirm]} onPress={handleDownload}>
                <Text style={[styles.btnText, styles.btnTextConfirm]}>Download</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  body: { color: '#ccc', fontSize: 14, marginBottom: 4 },
  estimate: { color: '#3c82ff', fontSize: 14, fontWeight: '600', marginBottom: 20 },
  spinner: { marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  btnCancel: { backgroundColor: 'rgba(255,255,255,0.1)' },
  btnConfirm: { backgroundColor: '#3c82ff' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnTextConfirm: { color: '#fff' },
});
