const VERSION = '2025.03.08.15';
const CACHE_NAME = `fetcher-${VERSION}`;
const urlsToCache = [
    '/',
    '/index.html',
    '/stylesheet/style.css',
    '/scripts/app.js',
    '/data/manifest.json',
    '/data/sites.json',
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
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)));
            await self.clients.claim();
        })()
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
    if (request.destination === 'document' || await isSiteRequest(request.url)) {
        try {
            const netResponse = await fetch(request);
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, netResponse.clone());
            return netResponse;
        } catch {
            const cached = await caches.match(request);
            if (cached) return cached;
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
