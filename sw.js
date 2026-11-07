/*
 * Times Up offline support. Installing the app keeps a copy of every file it
 * needs, so it opens and plays without a connection.
 *
 * Change VERSION whenever any file in FILES changes. That's how phones and
 * tablets with the app installed know to fetch the new copies; they switch
 * to them the next time the app is opened.
 *
 * Vosk (vendor/vosk), for checking reading on the device, is big, so it isn't
 * part of every install. Its code is kept the first time it's used, in its
 * own cache (VOSK_CACHE), and Vosk keeps its model in IndexedDB itself.
 */
const VERSION = '2026-11-07.1';
const CACHE = `timesup-${VERSION}`;
const VOSK_CACHE = 'vosk-0.0.8-times-up-1'; // change it if vendor/vosk/vosk.js ever changes
const FILES = [
  'index.html',
  'style.css',
  'quiz.js',
  'players.js',
  'insights.js',
  'lessons.js',
  'reading.js',
  'listen.js',
  'reader.js',
  'app.js',
  'pwa.js',
  'manifest.webmanifest',
  'fonts/fonts.css',
  'fonts/andika-400-latin.woff2',
  'fonts/andika-400-latin-ext.woff2',
  'fonts/andika-700-latin.woff2',
  'fonts/andika-700-latin-ext.woff2',
  'fonts/lilita-one-400-latin.woff2',
  'fonts/lilita-one-400-latin-ext.woff2',
  'icons/icon.svg',
  'icons/icon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // 'reload' skips the browser's ordinary cache, so a new version never keeps an old file.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => (key.startsWith('timesup-') && key !== CACHE) || (key.startsWith('vosk-') && key !== VOSK_CACHE)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const home = new URL(self.registration.scope).pathname;
  if (url.pathname === `${home}vendor/vosk/vosk.js`) {
    event.respondWith(caches.open(VOSK_CACHE).then(async (cache) => {
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    }));
    return;
  }
  // Opening the app, at its folder or at index.html, gets the saved page.
  if (request.mode === 'navigate' && (url.pathname === home || url.pathname === `${home}index.html`)) {
    event.respondWith(caches.match('index.html', { cacheName: CACHE }).then((saved) => saved || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((saved) => saved || fetch(request)));
});
