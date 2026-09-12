/* The scanner is a static, local-first app. Keep the shell available when a
   standalone window is opened without a network connection, while allowing
   same-origin additions to fill the cache as they are requested. */
// The shell key is a fingerprint of every local asset in the addAll list.
// Update it with any shell change so installed workers cannot serve stale UI.
const CACHE_NAME = "chain-scanner-shell-f0fd5ebfba7ea7f0fceaed2cff77d9e56bb614e2705a26b83423f91cd22f4cf2";

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
        "./icon-512.png",
        "./landscape.css",
        "./landscape-core.js",
        "./landscape.js",
        "./stars.js",
        "./vendor/astronomy.min.js",
        "./THIRD_PARTY_NOTICES.md",
        "./vendor/astronomy-LICENSE",
        "./vendor/HYG-LICENSE",
        "./vendor/CC-BY-SA-4.0.txt"
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
