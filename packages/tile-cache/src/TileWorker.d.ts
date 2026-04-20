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
export declare class WorkerTileCache {
    private worker;
    private seen;
    constructor();
    /**
     * Pre-fetch a single tile URL via the worker.
     * No-op if already fetched this session or if the worker is unavailable.
     */
    prefetch(url: string): void;
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
    prefetchViewport(template: string, zoom: number, north: number, south: number, east: number, west: number, padding?: number, maxTiles?: number): void;
    /**
     * Terminate the background worker and release resources.
     * Call this when the component using the cache unmounts.
     */
    destroy(): void;
}
