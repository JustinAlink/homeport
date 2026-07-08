// Minimal hand-rolled service worker — no Workbox, no build step.
// Only caches the static app shell. Never caches API routes or websocket
// traffic: this is a real-time Docker status dashboard, so stale cached
// data would be actively misleading.

const CACHE = 'homeport-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(url)
          } catch (err) {
            // one missing/failed asset shouldn't break the whole install
          }
        })
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle same-origin GET requests — everything else (cross-origin,
  // POST/PUT/etc., websocket upgrades) passes straight through to network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return
  }

  // Navigations: network-first, falling back to the cached shell so the
  // app still opens offline, but always prefers fresh HTML when online.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch (err) {
          const cache = await caches.open(CACHE)
          const cached = await cache.match('/')
          if (cached) return cached
          throw err
        }
      })()
    )
    return
  }

  const url = new URL(request.url)

  // Known static shell assets: cache-first.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })()
    )
    return
  }

  // Everything else (in particular /api/* and any live dashboard data):
  // pass through to network untouched, never cached.
})
