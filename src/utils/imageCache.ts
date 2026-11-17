import { getCachedImageFromSqlite, saveCachedImageToSqlite } from './sqlite';

const memoryImageCache = new Map<string, string>();
const inFlightFetches = new Map<string, Promise<string>>();
const CACHE_STORAGE_NAME = 'bm-product-images-v1';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to DataURL'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export async function resolveCachedImageUrl(url?: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  // 1. Fast memory hit
  const memHit = memoryImageCache.get(url);
  if (memHit) return memHit;

  // 2. Local SQLite image_cache hit
  const sqliteHit = getCachedImageFromSqlite(url);
  if (sqliteHit) {
    memoryImageCache.set(url, sqliteHit);
    return sqliteHit;
  }

  // 3. Browser Cache Storage hit (works offline even if CORS didn't allow reading blob earlier)
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_STORAGE_NAME);
      const cachedResp = await cache.match(url);
      if (cachedResp) {
        const blob = await cachedResp.blob();
        if (blob.size > 0 && blob.size <= 1_500_000) {
          const dataUrl = await blobToDataUrl(blob);
          memoryImageCache.set(url, dataUrl);
          saveCachedImageToSqlite(url, dataUrl, blob.type || 'image/jpeg');
          return dataUrl;
        }
      }
    } catch {
      // Ignore CacheStorage unavailability
    }
  }

  // If offline and not in cache, return original URL gracefully (component shows fallback icon on error)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return url;
  }

  // 4. Online: fetch and persist into SQLite + CacheStorage
  const existingPromise = inFlightFetches.get(url);
  if (existingPromise) return existingPromise;

  const fetchPromise = (async () => {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) return url;

      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(CACHE_STORAGE_NAME);
          await cache.put(url, response.clone());
        } catch {
          // ignore
        }
      }

      const blob = await response.blob();
      if (blob.size > 0 && blob.size <= 1_500_000) {
        const dataUrl = await blobToDataUrl(blob);
        memoryImageCache.set(url, dataUrl);
        saveCachedImageToSqlite(url, dataUrl, blob.type || 'image/jpeg');
        return dataUrl;
      }
      return url;
    } catch {
      return url;
    } finally {
      inFlightFetches.delete(url);
    }
  })();

  inFlightFetches.set(url, fetchPromise);
  return fetchPromise;
}

export function warmImageCache(urls: Array<string | undefined>): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const unique = Array.from(new Set(urls.filter((u): u is string => Boolean(u && u.startsWith('http')))));
  // Pre-cache gently in batches to avoid saturating bandwidth
  unique.slice(0, 30).forEach((u, index) => {
    setTimeout(() => {
      resolveCachedImageUrl(u).catch(() => {});
    }, index * 120);
  });
}
