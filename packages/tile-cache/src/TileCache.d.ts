/**
 * packages/tile-cache/src/TileCache.ts
 *
 * MBTiles-compatible SQLite tile cache for React Native / Expo.
 *
 * Schema
 * ------
 *  tiles(z, x, y, data BLOB, mime TEXT, cached_at INTEGER, last_accessed INTEGER)
 *  tile_access_log(z, x, y, last_accessed INTEGER)  -- updated on every read
 *
 * Strategy
 * --------
 *  1. On cache miss → fetch from backend → store in SQLite.
 *  2. On cache hit  → serve immediately, then check TTL:
 *       - Stale? Re-fetch silently in the background (stale-while-revalidate).
 *  3. On storage pressure → LRU eviction: remove tiles not accessed in 7 days,
 *     starting from the lowest zoom levels.
 *  4. Max cache size is configurable (default 500 MB).
 */
export interface TileCacheOptions {
    /** Maximum total tile data to store (bytes). Default: 500 MB */
    maxBytes?: number;
    /** Tiles older than this are considered stale (ms). Default: 30 days */
    ttlMs?: number;
    /** Backend tile URL template.  {z}/{x}/{y} will be interpolated. */
    tileUrlTemplate: string;
    /** Database filename (stored in the app's document directory). */
    dbName?: string;
}
export declare class TileCache {
    private db;
    private readonly maxBytes;
    private readonly ttlMs;
    private readonly tileUrlTemplate;
    private readonly dbName;
    constructor(options: TileCacheOptions);
    open(): Promise<void>;
    private getDb;
    /**
     * Fetch a tile, using the local cache when available.
     * Returns a base64-encoded string suitable for use as an image URI.
     */
    getTile(z: number, x: number, y: number): Promise<string>;
    /**
     * Prefetch a 3×3 grid of tiles surrounding (z, cx, cy) at zoom level z,
     * and also fetch the centre tile at zoom+1 for sharper detail.
     * All fetches are fire-and-forget; errors are silently ignored.
     */
    prefetchAround(z: number, cx: number, cy: number): void;
    /**
     * Evict tiles to bring the total cache size under maxBytes.
     * LRU order: remove tiles not accessed in 7 days first, lowest zoom first.
     */
    evictIfNeeded(): Promise<void>;
    /**
     * Delete all cached tiles (e.g. user-triggered cache clear).
     */
    clearAll(): Promise<void>;
    private tileUrl;
    private fetchAndStore;
}
