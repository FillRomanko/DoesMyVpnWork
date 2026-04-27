const CACHE_PREFIX = 'fetcher-';
const VERSION_URL = '/data/version.json';

const urlsToCache = [
    '/',
    '/index.html',
    '/stylesheet/style.css',
    '/stylesheet/reset.css',
    '/scripts/app.js',
    '/data/manifest.json',
    '/data/sites.json',
    '/icons/favicon.svg',
    '/data/version.json',
];

let resolvedCacheName = null;

async function getStoredVersion() {
    const keys = await caches.keys();
    const existing = keys
        .filter(key => key.startsWith(CACHE_PREFIX))
        .sort()
        .pop();

    if (!existing) {
        return { version: null, cacheName: null };
    }

    try {
        const cache = await caches.open(existing);
        const response = await cache.match(VERSION_URL);
        if (!response) {
            return { version: null, cacheName: existing };
        }

        const data = await response.json();
        return {
            version: data?.version ?? null,
            cacheName: existing
        };
    } catch {
        return { version: null, cacheName: existing };
    }
}

async function getNetworkVersion() {
    const resp = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!resp.ok) {
        throw new Error(`Failed to fetch version.json: ${resp.status}`);
    }

    const data = await resp.json();
    if (!data?.version) {
        throw new Error('version.json has no "version" field');
    }

    return data.version;
}

async function ensureVersionedCache() {
    if (resolvedCacheName) return resolvedCacheName;

    const stored = await getStoredVersion();

    try {
        const networkVersion = await getNetworkVersion();
        const nextCacheName = `${CACHE_PREFIX}${networkVersion}`;

        if (stored.version !== networkVersion) {
            const cache = await caches.open(nextCacheName);

            for (const url of urlsToCache) {
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn('[SW] Failed to cache:', url, err);
                }
            }

            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith(CACHE_PREFIX) && key !== nextCacheName)
                    .map(key => caches.delete(key))
            );
        }

        resolvedCacheName = nextCacheName;
        return resolvedCacheName;
    } catch {
        resolvedCacheName = stored.cacheName || `${CACHE_PREFIX}fallback`;

        if (resolvedCacheName === `${CACHE_PREFIX}fallback`) {
            const fallbackCache = await caches.open(resolvedCacheName);

            for (const url of urlsToCache) {
                try {
                    await fallbackCache.add(url);
                } catch {}
            }
        }

        return resolvedCacheName;
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        await ensureVersionedCache();
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await ensureVersionedCache();
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith((async () => {
        const cacheName = await ensureVersionedCache();
        const cache = await caches.open(cacheName);

        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
            const response = await fetch(event.request);

            if (response && response.ok) {
                event.waitUntil(cache.put(event.request, response.clone()));
            }

            return response;
        } catch {
            if (event.request.mode === 'navigate') {
                const fallback = await cache.match('/index.html');
                if (fallback) return fallback;
            }

            return new Response('Offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
    })());
});

self.addEventListener('message', event => {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});