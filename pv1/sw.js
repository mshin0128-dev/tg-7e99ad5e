/* TOEIC単語帳 Service Worker — アプリシェルをキャッシュしてオフラインで開けるようにする。
   アプリのファイルを更新したら CACHE_VERSION を上げること（古いキャッシュは activate で削除される）。 */
var CACHE_VERSION = "v2";
var CACHE_NAME = "toeic-shell-" + CACHE_VERSION;
var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "words.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 1つ失敗しても全体が失敗しないよう個別に追加する
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("toeic-shell-") === 0 && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // OpenAI など外部通信には触れない

  if (req.mode === "navigate") {
    // 画面遷移: ネット優先、オフラインならキャッシュ済みの index.html
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put("index.html", copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("index.html").then(function (r) { return r || caches.match("./"); });
      })
    );
    return;
  }

  // その他（JS/CSS等）: ネットワーク優先で常に最新を取りに行き、成功したらキャッシュも更新。
  // オフライン時のみキャッシュを返す（stale-while-revalidate だと更新が1回遅れて届くため）。
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
