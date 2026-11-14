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
  './assets/icon-maskable-512.png',
];

// SW 沒有 js/logger.js，這裡以相同的結構化格式記錄。
function logSwWarning(msg, ctx) {
  console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), msg, ctx }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// 啟用時清掉其他版本的快取，以及本快取中已不在 PRECACHE 的項目（例如改名或刪除的檔案），
// 避免長期累積佔用長輩手機的儲存空間。sw.js 內容（PRECACHE）改變時才會觸發新的 activate。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      const cache = await caches.open(CACHE);
      const keep = new Set(PRECACHE.map((p) => new URL(p, self.location.href).href));
      const entries = await cache.keys();
      await Promise.all(entries.filter((r) => !keep.has(r.url)).map((r) => cache.delete(r)));
      await self.clients.claim();
    })()
  );
});

// 弱網路下 fetch 可能掛很久才失敗；超過這個時間、而且快取裡有東西，就先用快取，
// 不讓長輩對著空白畫面等。背景的 fetch 仍會完成並更新快取，下次開啟就是新的。
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const fromNetwork = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches
        .open(CACHE)
        .then((c) => c.put(req, copy))
        .catch((e) => logSwWarning('SW 快取寫入失敗', { url: req.url, errorName: e?.name, error: e?.message }));
    }
    return res;
  });
  // 逾時後仍讓背景 fetch 跑完並寫入快取；同時避免它之後失敗時變成未處理的 rejection。
  event.waitUntil(fromNetwork.catch(() => {}));

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS)
  );
  // 網路真的失敗時的原有退路。
  const offlineFallback = () => {
    if (req.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  };

  event.respondWith(
    Promise.race([fromNetwork, timeout]).catch(async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // 快取沒有這個檔案（例如第一次造訪）：繼續等網路，不要因為逾時就提早失敗。
      return fromNetwork.catch(offlineFallback);
    })
  );
});
