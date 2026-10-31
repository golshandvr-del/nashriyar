// Nashriyar service worker — offline app shell + static asset cache.
// Security rule: NEVER cache API responses, media, or reader pages (paid content must not persist on disk).
const VERSION = 'nsh-v2'
const SHELL = ['/', '/index.html', '/theme-init.js', '/favicon.svg', '/manifest.webmanifest', '/offline.html', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // never touch API / media / reader traffic
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/read/')) return

  // hashed build assets: cache-first (immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
    return
  }

  // SPA navigations: network-first, fall back to cached shell, then offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put('/index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/offline.html')))
    )
    return
  }

  // other same-origin static files: stale-while-revalidate
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit)
        return hit || net
      })
    )
  }
})
