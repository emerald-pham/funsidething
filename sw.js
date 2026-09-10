/* The scanner is a static, local-first app. Keep the shell available when a
   standalone window is opened without a network connection, while allowing
   same-origin additions to fill the cache as they are requested. */
// The shell key is a fingerprint of every local asset in the addAll list.
// Update it with any shell change so installed workers cannot serve stale UI.
const CACHE_NAME = "chain-scanner-shell-e23e49f525d2d1b9ae46b2d7a3a1dd09ed4e4bfc5209627922d27d5dce0b1e1d";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icon.svg",
        "./icon-180.png",
        "./icon-192.png",
        "./icon-512.png"
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("chain-scanner-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if(requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request)
      .then(response => {
        if(response.ok && response.type === "basic"){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(error => event.request.mode === "navigate"
        ? caches.match("./index.html")
        : Promise.reject(error)))
  );
});
