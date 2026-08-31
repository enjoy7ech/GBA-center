const CACHE_NAME = 'gba-center-v6'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/gba-pattern.svg',
  '/nintendo-pattern.svg',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL)
      const indexResponse = await cache.match('/')
      const indexHtml = await indexResponse?.text()
      const buildAssets = indexHtml
        ? [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)[^"\s]*"/g)].map(match => match[1])
        : []
      if (buildAssets.length) await cache.addAll([...new Set(buildAssets)])
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    let cacheUpdate = Promise.resolve()
    const responsePromise =
      fetch(request)
        .then(response => {
          if (response.ok) {
            const responseForCache = response.clone()
            cacheUpdate = caches.open(CACHE_NAME)
              .then(cache => cache.put('/', responseForCache))
              .catch(reason => console.warn('[SW] 页面缓存写入失败。', reason))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/')) || Response.error())
    event.respondWith(responsePromise)
    event.waitUntil(responsePromise.then(() => cacheUpdate))
    return
  }

  let cacheUpdate = Promise.resolve()
  const responsePromise =
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok && response.status !== 206) {
          const responseForCache = response.clone()
          cacheUpdate = caches.open(CACHE_NAME)
            .then(cache => cache.put(request, responseForCache))
            .catch(reason => console.warn('[SW] 资源缓存写入失败。', reason))
        }
        return response
      })
    })
  event.respondWith(responsePromise)
  event.waitUntil(responsePromise.then(() => cacheUpdate))
})
