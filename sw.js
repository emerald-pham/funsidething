/* The scanner is a static, local-first app. Keep the shell available when a
   standalone window is opened without a network connection, while allowing
   same-origin additions to fill the cache as they are requested. */
// The shell key is a fingerprint of every local asset in the addAll list.
// Update it with any shell change so installed workers cannot serve stale UI.
const CACHE_NAME = "chain-scanner-shell-d65f81f84db869f7664aff10afba954dd3a15d3283ecffc078c15b9379d381ee";

self.addEventListener("message", event => {
  if(event?.data?.type!=="chain-scanner-support-diagnostics-v1") return;
  const port=event.ports?.[0];
  if(!port||typeof port.postMessage!=="function") return;
  try{port.postMessage({type:"chain-scanner-support-diagnostics-v1",cacheName:CACHE_NAME});}catch(_){ /* Diagnostics never affect worker behavior. */ }
});

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./app-release.js",
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
        "./landscape-visits.js",
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
    // Keep predecessor pages on their worker until all of its clients close.
    // Their older controllerchange handler can otherwise discard an unfocused
    // draft before the new page's session protection has a chance to run.
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

  // Release identity is deployment-specific, so it is never served from an
  // installed shell cache and never falls back to a stale envelope offline.
  const scopeUrl = self.registration?.scope ? new URL(self.registration.scope) : null;
  const releaseUrl = scopeUrl ? new URL("./channel-release.json", scopeUrl) : null;
  if(releaseUrl && requestUrl.origin === releaseUrl.origin && requestUrl.pathname === releaseUrl.pathname){
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    // Retirement may fail after this worker activates. Never let a retained
    // predecessor cache choose the document or modules for this shell.
    caches.match(event.request, {cacheName:CACHE_NAME}).then(cached => cached || fetch(event.request)
      .then(response => {
        if(response.ok && response.type === "basic"){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(error => event.request.mode === "navigate"
        ? caches.match("./index.html", {cacheName:CACHE_NAME})
        : Promise.reject(error)))
  );
});
