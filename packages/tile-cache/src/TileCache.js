"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TileCache = void 0;
const FileSystem = __importStar(require("expo-file-system"));
const SQLite = __importStar(require("expo-sqlite"));
// ---------------------------------------------------------------------------
// TileCache
// ---------------------------------------------------------------------------
class TileCache {
    constructor(options) {
        this.db = null;
        this.maxBytes = options.maxBytes ?? 500 * 1024 * 1024; // 500 MB
        this.ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days
        this.tileUrlTemplate = options.tileUrlTemplate;
        this.dbName = options.dbName ?? 'tile_cache.db';
    }
    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------
    async open() {
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
    getDb() {
        if (!this.db)
            throw new Error('TileCache: call open() before using the cache');
        return this.db;
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Fetch a tile, using the local cache when available.
     * Returns a base64-encoded string suitable for use as an image URI.
     */
    async getTile(z, x, y) {
        const db = this.getDb();
        const now = Date.now();
        // 1. Check local cache
        const row = await db.getFirstAsync('SELECT data, mime, cached_at, last_accessed FROM tiles WHERE z=? AND x=? AND y=?', [z, x, y]);
        if (row) {
            // Update last_accessed (fire-and-forget)
            db.runAsync('UPDATE tiles SET last_accessed=? WHERE z=? AND x=? AND y=?', [now, z, x, y]);
            // Stale-while-revalidate: if tile is stale, refresh in the background
            if (now - row.cachedAt > this.ttlMs) {
                this.fetchAndStore(z, x, y).catch(() => { });
            }
            return `data:${row.mime};base64,${row.data}`;
        }
        // 2. Cache miss → fetch synchronously
        return this.fetchAndStore(z, x, y);
    }
    /**
     * Prefetch a 3×3 grid of tiles surrounding (z, cx, cy) at zoom level z,
     * and also fetch the centre tile at zoom+1 for sharper detail.
     * All fetches are fire-and-forget; errors are silently ignored.
     */
    prefetchAround(z, cx, cy) {
        const tasks = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                tasks.push([z, cx + dx, cy + dy]);
            }
        }
        // Centre tile at higher resolution
        tasks.push([z + 1, cx * 2, cy * 2]);
        for (const [tz, tx, ty] of tasks) {
            this.getTile(tz, tx, ty).catch(() => { });
        }
    }
    /**
     * Evict tiles to bring the total cache size under maxBytes.
     * LRU order: remove tiles not accessed in 7 days first, lowest zoom first.
     */
    async evictIfNeeded() {
        const db = this.getDb();
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        // Estimate current size (SQLite page_count × page_size is approximate)
        const sizeRow = await db.getFirstAsync("SELECT (page_count * page_size) AS approx_bytes FROM pragma_page_count(), pragma_page_size()");
        const currentBytes = sizeRow?.approx_bytes ?? 0;
        if (currentBytes <= this.maxBytes)
            return;
        // Delete LRU tiles: oldest-accessed, lowest-zoom first
        await db.runAsync(`DELETE FROM tiles WHERE rowid IN (
         SELECT rowid FROM tiles WHERE last_accessed < ?
         ORDER BY z ASC, last_accessed ASC LIMIT 500
       )`, [sevenDaysAgo]);
    }
    /**
     * Delete all cached tiles (e.g. user-triggered cache clear).
     */
    async clearAll() {
        await this.getDb().runAsync('DELETE FROM tiles');
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    tileUrl(z, x, y) {
        return this.tileUrlTemplate
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
    }
    async fetchAndStore(z, x, y) {
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
        await this.getDb().runAsync(`INSERT OR REPLACE INTO tiles (z, x, y, data, mime, cached_at, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [z, x, y, base64, mime, now, now]);
        return `data:${mime};base64,${base64}`;
    }
}
exports.TileCache = TileCache;
