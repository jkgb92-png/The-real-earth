/**
 * packages/tile-cache/src/TileWorker.ts
 *
 * WorkerTileCache — offloads tile pre-fetching to a dedicated Web Worker.
 *
 * On web the browser's image cache is volatile: tiles cached via
 * `new Image().src` are evicted under memory pressure and not shared across
 * browser tabs.  WorkerTileCache uses the Cache API (via a worker) which:
 *
 *  1. Persists across page reloads (until explicitly evicted by the browser).
 *  2. Keeps the main thread free (fetch happens off-thread).
 *  3. Is URL-keyed — when MapLibre later requests the same tile URL via XHR
 *     the browser finds it in the Cache API and returns it instantly.
 *
 * On React Native (no Worker/Cache API) the class degrades gracefully: every
 * method becomes a no-op so the existing Expo SQLite TileCache is used
 * instead (via `packages/tile-cache/src/TileCache.ts`).
 *
 * Usage
 * -----
 *   import { WorkerTileCache } from '@the-real-earth/tile-cache';
 *   const cache = new WorkerTileCache();
 *
 *   // Warm the cache for a given tile URL template + viewport tiles:
 *   cache.prefetch('https://server.example.com/tiles/{z}/{x}/{y}.png', 3, 4, 5);
 *
 *   // Drain all queued work before unmounting:
 *   cache.destroy();
 */

// ── Coordinate helpers ────────────────────────────────────────────────────────

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** z,
  );
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class WorkerTileCache {
  private worker: Worker | null = null;
  private seen: Set<string> = new Set();

  constructor() {
    // Guard: Web Workers are only available in a browser context.
    if (
      typeof window === 'undefined' ||
      typeof Worker === 'undefined' ||
      typeof caches === 'undefined'
    ) {
      return;
    }

    try {
      // Next.js / webpack will bundle the worker file automatically when using
      // the `new Worker(new URL(...))` syntax.
      this.worker = new Worker(new URL('./tile.worker.ts', import.meta.url));
    } catch (err) {
      // Worker creation can fail under certain Content-Security-Policy
      // configurations or in restricted runtime environments.
      if (process.env.NODE_ENV === 'development') {
        console.warn('[WorkerTileCache] Failed to create tile worker:', err);
      }
      this.worker = null;
    }
  }

  /**
   * Pre-fetch a single tile URL via the worker.
   * No-op if already fetched this session or if the worker is unavailable.
   */
  prefetch(url: string): void {
    if (!this.worker) return;
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.worker.postMessage({ url });
  }

  /**
   * Pre-fetch all tiles in a viewport bounding box using the given URL template.
   *
   * @param template  URL template with `{z}`, `{x}`, `{y}` placeholders.
   * @param zoom      Current integer map zoom level.
   * @param north     Viewport north bound (degrees latitude).
   * @param south     Viewport south bound (degrees latitude).
   * @param east      Viewport east bound (degrees longitude).
   * @param west      Viewport west bound (degrees longitude).
   * @param padding   Extra tiles to fetch beyond the viewport edge (default 1).
   * @param maxTiles  Cap on the number of tile fetches per call (default 24).
   */
  prefetchViewport(
    template: string,
    zoom: number,
    north: number,
    south: number,
    east: number,
    west: number,
    padding = 1,
    maxTiles = 24,
  ): void {
    if (!this.worker) return;

    const z = Math.min(Math.round(zoom), 24);
    const maxIndex = 2 ** z - 1;
    const x0 = Math.max(0, lonToTileX(west,  z) - padding);
    const x1 = Math.min(maxIndex, lonToTileX(east,  z) + padding);
    const y0 = Math.max(0, latToTileY(north, z) - padding);
    const y1 = Math.min(maxIndex, latToTileY(south, z) + padding);

    let fetched = 0;
    outer: for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (fetched >= maxTiles) break outer;
        const url = template
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(y));
        this.prefetch(url);
        fetched++;
      }
    }
  }

  /**
   * Terminate the background worker and release resources.
   * Call this when the component using the cache unmounts.
   */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.seen.clear();
  }
}
