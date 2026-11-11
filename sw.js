/* same-folder offline cache only */
var CACHE_NAME = "tango-cache-v4";
var SCOPE_URL = new URL("./", self.location.href);
var ASSETS = [
  "./index.html",
  "./words.js",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png"
].map(function (p) { return new URL(p, SCOPE_URL).toString(); });

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== SCOPE_URL.origin) return;
  if (url.pathname.indexOf(new URL(".", SCOPE_URL).pathname) !== 0) return;

  event.respondWith(
    fetch(req, { cache: "no-store" }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (c) { return c || caches.match(new URL("./index.html", SCOPE_URL).toString()); });
    })
  );
});
