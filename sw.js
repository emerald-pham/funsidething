/* The scanner is a static, local-first app. Keep the shell available when a
   standalone window is opened without a network connection, while allowing
   same-origin additions to fill the cache as they are requested. */
// The shell key is a fingerprint of every local asset in the addAll list.
// Update it with any shell change so installed workers cannot serve stale UI.
const CACHE_NAME = "chain-scanner-shell-c0c8f1b57d7cdf3c57102bd91d80c8d307a20bf21455ab3f0d38f4750e01e3bc";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icon.svg",
        "./icon-41f9327e19b3.svg",
        "./icon-180.png",
        "./icon-180-730ffcc9de36.png",
        "./icon-192.png",
        "./icon-512.png",
        "./landscape.css",
        "./landscape-config.js",
        "./landscape-core.js",
        "./location.js",
        "./landscape-geometry.js",
        "./landscape-timeline.js",
        "./landscape-mood.js",
        "./landscape-appearance.js",
        "./landscape-riders.js",
        "./landscape-winter.js",
        "./landscape-seasonal.js",
        "./HUMAN_WRITTEN_HOURLY_TAGS.md",
        "./SPAWN_RATES.md",
        "./landscape.js",
        "./landscape-skywriter.js",
        "./stars.js",
        "./vendor/astronomy.min.js",
        "./vendor/lz-string-1.5.0.min.js",
        "./device-store-v2.js",
        "./cloud-store-v2.js",
        "./THIRD_PARTY_NOTICES.md",
        "./vendor/astronomy-LICENSE",
        "./vendor/lz-string-LICENSE",
        "./vendor/HYG-LICENSE",
        "./vendor/CC-BY-SA-4.0.txt"
      ].map(path => new Request(path, {cache:"reload"}))))
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
