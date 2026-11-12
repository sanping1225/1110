// Service Worker：讓網頁可以安裝成 App，並在離線時仍能開啟畫面。
// 策略：
//   - 本站的頁面、CSS、JS：先抓網路（拿到最新版），失敗才用快取。
//   - CDN 上固定版本的 supabase-js：先用快取（檔案不會變）。
//   - Supabase 資料 API：一律不快取，永遠向伺服器讀寫。
// 修改本站檔案後不需要改這裡；只有要強制清除舊快取時才把版本號加一。
const CACHE = "repair-app-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./design.html",
  "./style.css",
  "./app.js",
  "./design.js",
  "./config.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

const CDN_PREFIX = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // 離線時開啟沒快取過的頁面，退回首頁
    if (request.mode === "navigate") {
      const home = await cache.match("./index.html");
      if (home) return home;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (request.url.startsWith(CDN_PREFIX)) {
    event.respondWith(cacheFirst(request));
  }
  // 其他（例如 Supabase API）不攔截，直接連線
});
