/* yingbox PWA service worker — app shell cache */
const CACHE = 'yingbox-shell-v2'

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // API 与媒体直连服务。/media/files/<id> 没有扩展名，以前被当成静态文件缓存：
  // Cache API 不能存 206，克隆大文件流还会把 <video> 的 Range 响应拆掉，表现为无法播放。
  // /assets/ 交给浏览器的 HTTP 缓存。预压缩的 .br/.gz 带 Content-Encoding，
  // 放进 Cache API 再取出时可能被重复解码，懒加载的播放器脚本会坏。
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.startsWith('/assets/') ||
    req.headers.has('range')
  ) {
    return
  }

  // Navigations: network first, fallback cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone()
          caches
            .open(CACHE)
            .then(c => c.put('./index.html', copy))
            .catch(() => {})
          return res
        })
        .catch(() => caches.match('./index.html'))
    )
    return
  }

  // Same-origin static: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const fetching = fetch(req)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone()
              caches
                .open(CACHE)
                .then(c => c.put(req, copy))
                .catch(() => {})
            }
            return res
          })
          .catch(() => cached)
        return cached || fetching
      })
    )
  }
})
