// Service worker: permite instalar la app y abrirla sin conexión.
// Estrategia "primero la red": con internet siempre carga la versión más nueva;
// sin internet usa la última copia guardada. YouTube y Firebase siempre van a la red.
const CACHE = 'mye-v2';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/styles.css',
  'js/app.js',
  'js/schedule.js',
  'js/audio.js',
  'js/youtube.js',
  'js/store.js',
  'js/streak.js',
  'js/merge.js',
  'js/sync.js',
  'js/install.js',
  'js/presence.js',
  'js/firebase-config.js',
  'js/tick-worker.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/favicon-32.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
  // Todo lo demás (YouTube, Firebase) no pasa por aquí.
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./');
      if (page) return page;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}
