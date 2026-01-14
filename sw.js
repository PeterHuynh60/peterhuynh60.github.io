const CACHE_NAME = 'betting-dashboard-v1';
const urlsToCache = [
  '/bet.html',
  '/css/styles.css',
  'https://fonts.googleapis.com/css?family=Saira+Extra+Condensed:500,700',
  'https://fonts.googleapis.com/css?family=Muli:400,400i,800,800i',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install service worker and cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('Cache addAll failed:', err);
        // Don't fail installation if some resources can't be cached
      })
  );
  self.skipWaiting();
});

// Fetch event - serve from cache when possible
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(() => {
        // If both cache and network fail, return a basic response
        return new Response('Offline - please check your connection', {
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});
