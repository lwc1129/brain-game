// Service worker：讓網站可加到主畫面，並在沒有網路時仍能用內建題庫遊玩。
//
// 策略：network-first。有網路時一律拿最新版本（並更新快取），所以部署新版不需要手動改版號；
// 只有網路失敗時才改用快取。AI 出題 proxy 是跨網域請求，不經過這裡。
// PRECACHE 必須涵蓋所有網站執行期檔案；tests/e2e 的 site-files 測試會檢查兩者一致。
const CACHE = 'brain-game-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './questions.json',
  './css/styles.css',
  './js/app.js',
  './js/ai.js',
  './js/analytics.js',
  './js/config.js',
  './js/fallback-questions.js',
  './js/logger.js',
  './js/logic.js',
  './js/storage.js',
  './js/render/complete.js',
  './js/render/helpers.js',
  './js/render/loading.js',
  './js/render/question.js',
  './js/render/step.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          // 只有「開啟頁面」才退回首頁；其他檔案找不到就照常失敗（例如題庫改用內建題庫）。
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
