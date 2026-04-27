const CACHE_PREFIX = 'fetcher-';
const VERSION_URL = '/data/version.json';

const APP_SHELL_URLS = [
    '/',
    '/index.html',
    '/stylesheet/style.css',
    '/stylesheet/reset.css',
    '/scripts/app.js',
    '/data/manifest.json',
    '/data/sites.json',
    '/icons/favicon.svg',
];

async function fetchVersion() {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Failed to fetch version.json: ${response.status}`);
    }

    const data = await response.json();
    if (!data?.version) {
        throw new Error('version.json has no "version" field');
    }

    return data.version;
}

function getCacheName(version) {
    return `${CACHE_PREFIX}${version}`;
}

async function getActiveCacheName() {
    const keys = await caches.keys();
    const versionedKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));

    if (versionedKeys.length === 0) return null;

    versionedKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return versionedKeys[versionedKeys.length - 1];
}

async function precacheAppShell(cacheName) {
    const cache = await caches.open(cacheName);

    await Promise.all(
        APP_SHELL_URLS.map(async (url) => {
            try {
                await cache.add(new Request(url, { cache: 'no-store' }));
            } catch (error) {
                console.warn('[SW] Failed to precache:', url, error);
            }
        })
    );
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const version = await fetchVersion();
        const cacheName = getCacheName(version);

        await precacheAppShell(cacheName);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const version = await fetchVersion();
        const currentCacheName = getCacheName(version);

        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter(key => key.startsWith(CACHE_PREFIX) && key !== currentCacheName)
                .map(key => caches.delete(key))
        );

        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    if (url.origin !== location.origin) return;

    event.respondWith((async () => {
        const activeCacheName = await getActiveCacheName();
        const cache = activeCacheName ? await caches.open(activeCacheName) : null;

        // version.json: network-first
        if (url.pathname === '/data/version.json') {
            try {
                const networkResponse = await fetch(event.request, { cache: 'no-store' });

                if (cache && networkResponse.ok) {
                    event.waitUntil(cache.put(event.request, networkResponse.clone()));
                }

                return networkResponse;
            } catch {
                if (cache) {
                    const cachedResponse = await cache.match(event.request, { ignoreSearch: false });
                    if (cachedResponse) return cachedResponse;
                }

                return new Response(JSON.stringify({ version: null }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });
            }
        }

        if (event.request.mode === 'navigate') {
            try {
                const networkResponse = await fetch(event.request, { cache: 'no-store' });

                if (cache && networkResponse.ok) {
                    event.waitUntil(cache.put('/index.html', networkResponse.clone()));
                }

                return networkResponse;
            } catch {
                if (cache) {
                    const cachedIndex = await cache.match('/index.html');
                    if (cachedIndex) return cachedIndex;
                }

                return new Response('Offline', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            }
        }

        if (cache) {
            const cachedResponse = await cache.match(event.request, { ignoreSearch: false });
            if (cachedResponse) {
                event.waitUntil((async () => {
                    try {
                        const freshResponse = await fetch(event.request, { cache: 'no-store' });
                        if (freshResponse.ok) {
                            await cache.put(event.request, freshResponse.clone());
                        }
                    } catch {}
                })());

                return cachedResponse;
            }
        }

        try {
            const networkResponse = await fetch(event.request, { cache: 'no-store' });

            if (cache && networkResponse.ok) {
                event.waitUntil(cache.put(event.request, networkResponse.clone()));
            }

            return networkResponse;
        } catch {
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