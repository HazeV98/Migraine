// Service worker: l'app funziona anche offline.
// File dell'app: prima la rete (così dopo un aggiornamento vedi subito la versione nuova),
// con la cache come ripiego se sei offline o la rete è lenta (oltre 3 secondi).
// Font e librerie esterne: dalla cache, aggiornate in background.
// Le chiamate a Telegram non passano da qui.
const CACHE = 'migraine-v3';
const SHELL = ['./', 'index.html', 'migraine.js', 'privacy.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const EXTERNAL = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
    const sameOrigin = url.origin === location.origin;
    if (!sameOrigin && !EXTERNAL.includes(url.hostname)) return;

    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const lookup = () => cache.match(req, { ignoreSearch: req.mode === 'navigate' });
        const store = res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; };

        if (sameOrigin) {
            // rete prima (saltando la cache HTTP del browser), cache come ripiego
            const network = fetch(req, { cache: 'no-cache' }).then(store);
            const slow = new Promise(r => setTimeout(() => r(null), 3000));
            try {
                const res = await Promise.race([network, slow]);
                if (res) return res;
            } catch (err) { /* offline: si passa alla cache */ }
            e.waitUntil(network.catch(() => {}));
            const cached = await lookup();
            if (cached) return cached;
            try { return await network; } catch (err) {}
            if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
            return new Response('', { status: 504 });
        }

        // font e librerie esterne: cache subito, aggiornamento in background
        const cached = await lookup();
        const network = fetch(req).then(store).catch(() => null);
        if (cached) { e.waitUntil(network); return cached; }
        return (await network) || new Response('', { status: 504 });
    })());
});
