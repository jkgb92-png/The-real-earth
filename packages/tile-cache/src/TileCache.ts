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

import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface CachedTile {
  data: string; // base64-encoded tile bytes from expo-sqlite
  mime: string;
  cachedAt: number;
  lastAccessed: number;
}

// ---------------------------------------------------------------------------
// TileCache
// ---------------------------------------------------------------------------

export class TileCache {
  private db: SQLite.SQLiteDatabase | null = null;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly tileUrlTemplate: string;
  private readonly dbName: string;

  constructor(options: TileCacheOptions) {
    this.maxBytes = options.maxBytes ?? 500 * 1024 * 1024; // 500 MB
    this.ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days
    this.tileUrlTemplate = options.tileUrlTemplate;
    this.dbName = options.dbName ?? 'tile_cache.db';
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async open(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync(this.dbName);
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS tiles (
        z             INTEGER NOT NULL,
        x             INTEGER NOT NULL,
        y             INTEGER NOT NULL,
        data          BLOB    NOT NULL,
        mime          TEXT    NOT NULL DEFAULT 'image/png',
        cached_at     INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        PRIMARY KEY (z, x, y)
      );
      CREATE INDEX IF NOT EXISTS idx_tiles_last_accessed ON tiles(last_accessed);
      CREATE INDEX IF NOT EXISTS idx_tiles_zoom ON tiles(z);
    `);
  }

  private getDb(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error('TileCache: call open() before using the cache');
    return this.db;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fetch a tile, using the local cache when available.
   * Returns a base64-encoded string suitable for use as an image URI.
   */
  async getTile(z: number, x: number, y: number): Promise<string> {
    const db = this.getDb();
    const now = Date.now();

    // 1. Check local cache
    const row = await db.getFirstAsync<CachedTile>(
      'SELECT data, mime, cached_at, last_accessed FROM tiles WHERE z=? AND x=? AND y=?',
      [z, x, y],
    );

    if (row) {
      // Update last_accessed (fire-and-forget)
      db.runAsync('UPDATE tiles SET last_accessed=? WHERE z=? AND x=? AND y=?', [now, z, x, y]);

      // Stale-while-revalidate: if tile is stale, refresh in the background
      if (now - row.cachedAt > this.ttlMs) {
        this.fetchAndStore(z, x, y).catch(() => {/* ignore background errors */});
      }

      return `data:${row.mime};base64,${row.data}`;
    }

    // 2. Cache miss → fetch synchronously
    return this.fetchAndStore(z, x, y);
  }

  /**
   * Prefetch a 3×3 grid of tiles surrounding (z, cx, cy) at zoom level z,
   * and also fetch the centre tile at zoom+1 for sharper detail.
   * At z ≤ 4 (global / polar view) the grid expands to 5×5 so that Arctic
   * and Antarctic tiles are warm before the user pans to the poles.
   * All fetches are fire-and-forget; errors are silently ignored.
   */
  prefetchAround(z: number, cx: number, cy: number): void {
    const tasks: Array<[number, number, number]> = [];
    // Expand to ±2 tiles at very low zooms to cover polar gaps cheaply.
    const radius = z <= 4 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        tasks.push([z, cx + dx, cy + dy]);
      }
    }
    // Centre tile at higher resolution
    tasks.push([z + 1, cx * 2, cy * 2]);

    for (const [tz, tx, ty] of tasks) {
      this.getTile(tz, tx, ty).catch(() => {/* prefetch failures are non-fatal */});
    }
  }

  /**
   * Evict tiles to bring the total cache size under maxBytes.
   * LRU order: remove tiles not accessed in 7 days first, lowest zoom first.
   */
  async evictIfNeeded(): Promise<void> {
    const db = this.getDb();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Estimate current size (SQLite page_count × page_size is approximate)
    const sizeRow = await db.getFirstAsync<{ approx_bytes: number }>(
      "SELECT (page_count * page_size) AS approx_bytes FROM pragma_page_count(), pragma_page_size()",
    );
    const currentBytes = sizeRow?.approx_bytes ?? 0;
    if (currentBytes <= this.maxBytes) return;

    // Delete LRU tiles: oldest-accessed, lowest-zoom first
    await db.runAsync(
      `DELETE FROM tiles WHERE rowid IN (
         SELECT rowid FROM tiles WHERE last_accessed < ?
         ORDER BY z ASC, last_accessed ASC LIMIT 500
       )`,
      [sevenDaysAgo],
    );
  }

  /**
   * Delete all cached tiles (e.g. user-triggered cache clear).
   */
  async clearAll(): Promise<void> {
    await this.getDb().runAsync('DELETE FROM tiles');
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private tileUrl(z: number, x: number, y: number): string {
    return this.tileUrlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  private async fetchAndStore(z: number, x: number, y: number): Promise<string> {
    const url = this.tileUrl(z, x, y);
    const tmpPath = `${FileSystem.cacheDirectory}tile_${z}_${x}_${y}.tmp`;

    const result = await FileSystem.downloadAsync(url, tmpPath, {
      headers: { Accept: 'image/webp,image/png,*/*' },
    });

    if (result.status !== 200) {
      throw new Error(`Tile fetch failed: HTTP ${result.status} for ${url}`);
    }

    const base64 = await FileSystem.readAsStringAsync(tmpPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(tmpPath, { idempotent: true });

    const mime = result.headers['content-type'] ?? 'image/png';
    const now = Date.now();

    await this.getDb().runAsync(
      `INSERT OR REPLACE INTO tiles (z, x, y, data, mime, cached_at, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [z, x, y, base64, mime, now, now],
    );

    return `data:${mime};base64,${base64}`;
  }
}
