/**
 * packages/map-core/src/layers.ts
 *
 * Shared layer descriptor types and registry factory for the Map Layer Manager.
 *
 * Three built-in base layers
 * --------------------------
 *  rgb  — Standard high-resolution Sentinel-2 RGB composite (@2x, 512 px tiles)
 *  ndvi — Vegetation health index: (NIR − Red) / (NIR + Red), colourised
 *  sar  — Cloud-piercing Sentinel-1 SAR backscatter (grayscale)
 *
 * Usage
 * -----
 *   import { buildLayerRegistry, BaseLayerId } from '@the-real-earth/map-core';
 *   const registry = buildLayerRegistry('https://your-tile-server');
 *   const desc = registry['ndvi'];
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BaseLayerId = 'rgb' | 'ndvi' | 'sar';

export interface LayerDescriptor {
  /** Unique layer identifier */
  id: BaseLayerId;
  /** Human-readable display name */
  label: string;
  /** Emoji / icon shown in the UI */
  icon: string;
  /** Accent colour (hex) used for the active state highlight */
  activeColor: string;
  /** Short description shown in layer panels */
  description: string;
  /** Tile URL template ({z}/{x}/{y} will be substituted) */
  tileUrlTemplate: string;
  /**
   * Tile size in pixels.
   *  512 → native @2x tiles; render at tileSize=256 in MapLibre so that Retina
   *        screens receive a pixel-perfect 1:1 match.
   *  256 → standard tiles.
   */
  tileSize: 256 | 512;
  /** Device pixel ratio hint (2 for @2x RGB tiles, 1 for NDVI/SAR) */
  pixelRatio: 1 | 2;
  /** Minimum zoom level at which the layer has data */
  minZoom: number;
  /** Maximum zoom level served by the backend */
  maxZoom: number;
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Build a registry of all three base-layer descriptors, resolving URLs
 * against the given tile server base URL at runtime.
 *
 * @param tileServerUrl  Base URL of the FastAPI tile server (no trailing slash).
 */
export function buildLayerRegistry(
  tileServerUrl: string,
): Record<BaseLayerId, LayerDescriptor> {
  return {
    rgb: {
      id: 'rgb',
      label: 'Standard RGB',
      icon: '🌍',
      activeColor: '#f59e0b',
      description: 'High-res Sentinel-2 cloud-free composite',
      tileUrlTemplate: `${tileServerUrl}/tiles/sentinel/{z}/{x}/{y}`,
      tileSize: 512,
      pixelRatio: 2,
      minZoom: 10,
      maxZoom: 25,
    },
    ndvi: {
      id: 'ndvi',
      label: 'Vegetation (NDVI)',
      icon: '🌿',
      activeColor: '#4ade80',
      description: 'NDVI: (NIR − Red) / (NIR + Red)',
      tileUrlTemplate: `${tileServerUrl}/tiles/ndvi/{z}/{x}/{y}`,
      tileSize: 256,
      pixelRatio: 1,
      minZoom: 10,
      maxZoom: 25,
    },
    sar: {
      id: 'sar',
      label: 'Cloud-Piercing (SAR)',
      icon: '📡',
      activeColor: '#94a3b8',
      description: 'Sentinel-1 SAR backscatter — sees through clouds',
      tileUrlTemplate: `${tileServerUrl}/tiles/sar/{z}/{x}/{y}`,
      tileSize: 256,
      pixelRatio: 1,
      minZoom: 6,
      maxZoom: 20,
    },
  };
}
