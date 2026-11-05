// Service worker: l'app funziona offline.
// File dell'app e librerie/font esterni: risposta dalla cache e aggiornamento in background
// (dopo un nuovo deploy la versione aggiornata appare alla riapertura successiva).
// Le chiamate a Telegram non passano da qui.
const CACHE = 'migraine-v1';
const SHELL = ['./', 'index.html', 'migraine.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const EXTERNAL = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== location.origin && !EXTERNAL.includes(url.hostname)) return;

    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
        const network = fetch(req).then(res => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
        }).catch(() => null);
        if (cached) { e.waitUntil(network); return cached; }
        const res = await network;
        if (res) return res;
        if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
        return new Response('', { status: 504 });
    })());
});
