// Keeps a copy of the simulator's files so that the page reloads even while the server is unreachable
// (a started attempt continues offline). Always tries the network first, so updates apply at once.

const CACHE = 'labzsk-v2';
const FILES = ['./', 'index.html', 'css/cpu.css', 'css/style.css', 'js/app.js', 'js/engine.js', 'js/isa.js', 'js/i18n.js',
  'js/files.js', 'js/attempt.js', 'js/store.js', 'js/cpu-view.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || url.origin !== scope.origin) return;
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('api/') || rel.startsWith('panel')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? './' : e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request.mode === 'navigate' ? './' : e.request, { ignoreSearch: true })));
});
