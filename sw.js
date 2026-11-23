// Keeps Nook's own files (not your workspace) in the browser, so the hosted site also starts without a
// connection (e.g. on the phone in the subway). Always the newest version when online: the network
// is asked first, the kept copy is used only when it doesn't answer in time.
const CACHE = 'nook-app';
// changes with every build (scripts/preload.mjs), so a new version is installed and kept completely
const BUILD = 'ae4ce768f88a';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  // every file of the app at once (files.json), not only the ones a visit happened to load: parts that load
  // on demand (import, export …) work offline too
  e.waitUntil((async () => {
    try {
      const list = await (await fetch('files.json?' + BUILD, { cache: 'no-store' })).json();
      const cache = await caches.open(CACHE);
      await Promise.allSettled(['./', ...list].map(async (u) => { const res = await fetch(u, { cache: 'no-store' }); if (res.ok) await cache.put(new URL(u, self.registration.scope).href, res); }));
    } catch { /* offline or no list: files are kept as they are used */ }
  })());
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; });
    const kept = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (!kept) return net;
    // online: the fresh file; slow or offline: the kept one
    return Promise.race([net.catch(() => kept), new Promise((ok) => setTimeout(() => ok(kept), 3000))]);
  })());
});
