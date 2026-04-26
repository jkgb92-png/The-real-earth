/**
 * packages/tile-cache/src/tile.worker.ts
 *
 * Dedicated Web Worker that pre-fetches tile images and stores them in the
 * Cache API (a persistent, URL-keyed storage available in Web Workers).
 *
 * Using the Cache API (rather than IndexedDB) is the idiomatic choice for
 * HTTP response caching:
 *  - Responses are stored keyed by URL, exactly as the browser's HTTP cache
 *    uses them.
 *  - MapLibre's internal XHR fetches will find tiles in the Cache API via the
 *    browser's fetch interception (when paired with a service worker), or they
 *    land in the shared network cache when MapLibre uses the same URL.
 *  - Cache API is natively available in Web Workers — no third-party dependency.
 *
 * Protocol
 * --------
 *  Incoming message: { url: string }
 *    → Fetch the URL and cache the response (no-op if already cached).
 *
 * The worker silently ignores fetch errors so a slow/offline tile server
 * never surfaces as an error in the application.
 */

const CACHE_NAME = 'tile-prefetch-v1';

type WorkerMessage =
  | { type?: undefined; url: string }
  | { type: 'prefetch'; url: string }
  | { type: 'clearAll' };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  // Legacy path: bare { url } message (no explicit type field)
  if (!msg.type || msg.type === 'prefetch') {
    const url = (msg as { url: string }).url;
    if (!url) return;

    try {
      const cache = await caches.open(CACHE_NAME);
      // If already cached, do nothing
      const existing = await cache.match(url);
      if (existing) return;

      // Fetch with a tile-friendly Accept header
      const resp = await fetch(url, {
        headers: { Accept: 'image/webp,image/png,image/*' },
        // Use only the network (bypass SW cache to avoid double-storing)
        cache: 'no-cache',
      });

      if (!resp.ok) return;

      // Clone before consuming — put() reads the body stream
      await cache.put(url, resp);
    } catch {
      // Silently discard network or cache errors
    }
    return;
  }

  if (msg.type === 'clearAll') {
    try {
      await caches.delete(CACHE_NAME);
    } catch {
      // Silently discard errors
    }
  }
};
