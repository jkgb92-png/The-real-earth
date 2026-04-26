'use client';

/**
 * apps/web/src/hooks/useTilePrefetch.ts
 *
 * Predictive tile pre-fetching for raster map layers.
 *
 * Given the current map viewport, this hook calculates every tile coordinate
 * visible on screen plus a 1-tile border in all directions (to pre-load tiles
 * the user is likely to pan into), and schedules them as low-priority fetches.
 *
 * Two prefetch strategies are supported:
 *
 *  1. Default (no `workerCache`): uses `new Image().src` so tiles land in the
 *     browser's volatile image/HTTP cache — fast and zero-dependency, but not
 *     guaranteed to survive across page reloads.
 *
 *  2. WorkerTileCache: delegates to a background Web Worker that stores tiles
 *     in the Cache API.  This is a persistent, URL-keyed store that survives
 *     page reloads and is shared across tabs.  Use this for the primary
 *     Sentinel / NDVI / SAR layers where cold-start blurriness matters most.
 *
 * Usage
 * -----
 *   const workerCache = useMemo(() => new WorkerTileCache(), []);
 *   const prefetch = useTilePrefetch([ESRI_URL, sentinelTileUrl], 24, workerCache);
 *
 *   // in onMove debounce handler:
 *   const bounds = mapRef.current.getBounds();
 *   prefetch({ zoom, north: bounds.getNorth(), south: ..., east: ..., west: ... });
 *
 * Notes
 * -----
 * - `new Image().src` is used (for the non-worker path) rather than `fetch()`
 *   because tile responses are images; the browser stores them in the image
 *   cache (shared with <img> and MapLibre's internal XHR cache).
 * - Already-prefetched URLs are remembered in a ref-based Set and skipped on
 *   subsequent calls so no tile is fetched twice per session (both paths).
 * - The cap of `maxTiles` (default 24) keeps each pan from spawning dozens of
 *   simultaneous requests on slow connections.
 * - Retina / high-DPR screens: pass the same zoom the Map component is using
 *   (which already accounts for pixelRatio via the `pixelRatio` Map prop).
 */

import { useCallback, useRef } from 'react';
import type { WorkerTileCache } from '@the-real-earth/tile-cache';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Bounding box of the current map viewport, as returned by map.getBounds(). */
export interface TilePrefetchViewport {
  /** Current map zoom level (fractional). */
  zoom: number;
  north: number;
  south: number;
  east: number;
  west: number;
}

// ── Coordinate math ───────────────────────────────────────────────────────────

/** Convert a longitude to the tile column index at zoom level z. */
function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

/**
 * Convert a latitude to the tile row index at zoom level z.
 * Uses the standard Web Mercator / OSM tile numbering (Y axis inverted vs TMS).
 */
function latToTileY(lat: number, z: number): number {
  // Clamp to avoid Math.log(0) / division by zero near the poles
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** z,
  );
}

/** Expand a tile URL template, substituting {z}, {x}, and {y}. */
function buildTileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useTilePrefetch
 *
 * Returns a stable `prefetch(viewport)` callback. Call it inside a debounced
 * `onMove` / `onZoom` handler with the current map bounds to warm the browser
 * tile cache ahead of MapLibre's own requests.
 *
 * Polar coverage
 * ──────────────
 * Web Mercator tiles do not extend past ±85.05° latitude, so the standard
 * y-range calculation misses tiles near the poles.  When the viewport north
 * bound is above POLAR_THRESHOLD (70 °N) or south bound is below
 * -POLAR_THRESHOLD (70 °S) we schedule an additional pass that covers the
 * full x range at that zoom level for the extreme latitude rows.  This ensures
 * Arctic and Antarctic tiles are warm before the user pans there.
 *
 * @param tileUrlTemplates  Array of URL templates containing `{z}`, `{x}`, `{y}`.
 * @param maxTiles          Maximum tiles to schedule per `prefetch()` call (default 24).
 * @param workerCache       Optional WorkerTileCache instance. When provided, tiles
 *                          are fetched off-thread and stored in the Cache API
 *                          (persistent across page reloads). When omitted the
 *                          default `new Image().src` browser-cache path is used.
 */
export function useTilePrefetch(
  tileUrlTemplates: string[],
  maxTiles = 24,
  workerCache?: WorkerTileCache | null,
): (viewport: TilePrefetchViewport) => void {
  /** URLs already pre-fetched this session — avoids redundant requests. */
  const seen = useRef<Set<string>>(new Set());

  return useCallback(
    (viewport: TilePrefetchViewport) => {
      if (typeof window === 'undefined') return;
      if (tileUrlTemplates.length === 0) return;

      // Snap to an integer zoom; never exceed MapLibre's hard cap of 24.
      const z = Math.min(Math.round(viewport.zoom), 24);
      const maxIndex = 2 ** z - 1;

      // Calculate tile range covering the viewport + 1-tile padding on each side.
      const x0 = Math.max(0, lonToTileX(viewport.west, z) - 1);
      const x1 = Math.min(maxIndex, lonToTileX(viewport.east, z) + 1);
      const y0 = Math.max(0, latToTileY(viewport.north, z) - 1);
      const y1 = Math.min(maxIndex, latToTileY(viewport.south, z) + 1);

      let fetched = 0;

      outer: for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (const template of tileUrlTemplates) {
            if (fetched >= maxTiles) break outer;

            const url = buildTileUrl(template, z, x, y);
            if (seen.current.has(url)) continue;
            seen.current.add(url);

            if (workerCache) {
              workerCache.prefetch(url);
            } else {
              const img = new Image();
              img.src = url;
            }
            fetched++;
          }
        }
      }

      // ── Polar prefetch pass ────────────────────────────────────────────────
      // When the viewport touches high latitudes, schedule the extreme tile
      // rows so Arctic / Antarctic tiles are warm when the user pans there.
      // We limit this to z ≤ 6 to keep request counts reasonable; above that
      // the tile count at the poles is too large to prefetch cheaply.
      const POLAR_THRESHOLD = 70;
      if (z <= 6) {
        const polarRows: number[] = [];
        if (viewport.north > POLAR_THRESHOLD) {
          // Top rows (Arctic): y values close to 0
          const yPolar = latToTileY(85.051129, z);
          for (let py = yPolar; py <= Math.min(maxIndex, yPolar + 1); py++) {
            polarRows.push(py);
          }
        }
        if (viewport.south < -POLAR_THRESHOLD) {
          // Bottom rows (Antarctic): y values close to maxIndex
          const yPolar = latToTileY(-85.051129, z);
          for (let py = Math.max(0, yPolar - 1); py <= yPolar; py++) {
            polarRows.push(py);
          }
        }
        if (polarRows.length > 0) {
          const polarMaxTiles = Math.min(maxTiles, 2 ** z); // never exceed total row width
          let polarFetched = 0;
          polarOuter: for (const template of tileUrlTemplates) {
            for (let px = 0; px <= maxIndex; px++) {
              for (const py of polarRows) {
                if (polarFetched >= polarMaxTiles) break polarOuter;
                const url = buildTileUrl(template, z, px, py);
                if (seen.current.has(url)) continue;
                seen.current.add(url);
                if (workerCache) {
                  workerCache.prefetch(url);
                } else {
                  const img = new Image();
                  img.src = url;
                }
                polarFetched++;
              }
            }
          }
        }
      }
    },
    // Recompute only when the set of template URLs, cap, or workerCache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tileUrlTemplates.join('\0'), maxTiles, workerCache],
  );
}

