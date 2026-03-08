const VERSION = '2025.03.08.16';
const CACHE_NAME = `fetcher-${VERSION}`;
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    'data/manifest.json',
    'data/sites.json',
    '/icons/favicon.svg',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => clients.claim())
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
    // Проверь кэш сначала
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.destination === 'document' || isSiteRequest(request.url)) {
        try {
            const netResponse = await fetch(request);
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, netResponse.clone());
            return netResponse;
        } catch {
            return new Response('Offline: сайты недоступны', { status: 503 });
        }
    }

    return caches.match('/index.html');
}


async function isSiteRequest(url) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const sitesResp = await cache.match('/data/sites.json');
        const sites = await sitesResp.json();
        return sites.some(site => url.startsWith(site));
    } catch {
        return false;
    }
}
