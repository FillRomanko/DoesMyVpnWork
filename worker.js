const CACHE_PREFIX = 'fetcher-';
const VERSION_URL = '/data/version.json';

const APP_SHELL = [
    '/',
    '/index.html',
    '/stylesheet/style.css',
    '/stylesheet/reset.css',
    '/scripts/app.js',
    '/data/manifest.json',
    '/data/sites.json',
    '/icons/favicon.svg',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/data/version.json',
];

let currentCacheName = null;

async function fetchVersionFromNetwork() {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Failed to fetch version.json: ${response.status}`);
    }

    const data = await response.json();

    if (!data?.version) {
        throw new Error('version.json does not contain "version"');
    }

    return data.version;
}

async function getActiveCacheName() {
    if (currentCacheName) return currentCacheName;

    try {
        const version = await fetchVersionFromNetwork();
        currentCacheName = `${CACHE_PREFIX}${version}`;
        return currentCacheName;
    } catch {
        const keys = await caches.keys();
        const existing = keys
            .filter(key => key.startsWith(CACHE_PREFIX))
            .sort()
            .pop();

        currentCacheName = existing || `${CACHE_PREFIX}fallback`;
        return currentCacheName;
    }
}

async function precacheAppShell(cacheName) {
    const cache = await caches.open(cacheName);

    for (const url of APP_SHELL) {
        try {
            await cache.add(url);
        } catch (err) {
            console.warn('[SW] Failed to precache:', url, err);
        }
    }
}

async function installCurrentVersion() {
    const version = await fetchVersionFromNetwork();
    const cacheName = `${CACHE_PREFIX}${version}`;
    await precacheAppShell(cacheName);
    currentCacheName = cacheName;
}

async function deleteOldCaches(keepCacheName) {
    const keys = await caches.keys();

    await Promise.all(
        keys
            .filter(key => key.startsWith(CACHE_PREFIX) && key !== keepCacheName)
            .map(key => caches.delete(key))
    );
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);

        if (response && response.ok) {
            await cache.put(request, response.clone());
        }

        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;

        throw new Error('Network and cache both failed');
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) return cached;

    const response = await fetch(request);

    if (response && response.ok) {
        await cache.put(request, response.clone());
    }

    return response;
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        try {
            await installCurrentVersion();
        } catch (err) {
            console.warn('[SW] Install fallback:', err);

            const fallbackName = `${CACHE_PREFIX}fallback`;
            await precacheAppShell(fallbackName);
            currentCacheName = fallbackName;
        }

        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheName = await getActiveCacheName();
        await deleteOldCaches(cacheName);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    event.respondWith((async () => {
        const cacheName = await getActiveCacheName();

        try {
            // version.json всегда стараемся брать из сети
            if (url.pathname === '/data/version.json') {
                return await networkFirst(event.request, cacheName);
            }

            // HTML-навигация тоже network-first, чтобы обновления приходили сразу
            if (event.request.mode === 'navigate') {
                try {
                    return await networkFirst(new Request('/index.html', { cache: 'no-store' }), cacheName);
                } catch {
                    const cache = await caches.open(cacheName);
                    const fallback = await cache.match('/index.html');
                    if (fallback) return fallback;
                    throw new Error('No offline index.html');
                }
            }

            // Часто меняющиеся данные и основной js — через сеть сначала
            if (
                url.pathname === '/scripts/app.js' ||
                url.pathname === '/data/sites.json' ||
                url.pathname === '/data/manifest.json'
            ) {
                return await networkFirst(event.request, cacheName);
            }

            // Статика — сначала из кэша
            return await cacheFirst(event.request, cacheName);
        } catch {
            if (event.request.mode === 'navigate') {
                const cache = await caches.open(cacheName);
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