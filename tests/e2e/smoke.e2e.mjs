// 端到端 smoke test：以真實瀏覽器操作 scripts/build_site.sh 產出的網站（即實際部署內容）。
// 不發外部網路請求：題庫由本機 server 提供，Google Fonts 等外部請求一律攔截。
// 執行：node --test --test-concurrency=1 tests/e2e/*.e2e.mjs
// 需要 playwright（CI 以 npm i --no-save 安裝，不寫入 package.json，維持零 runtime 依賴）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

let siteDir;
let server;
let baseUrl;
let browser;

before(async () => {
  siteDir = mkdtempSync(join(tmpdir(), 'brain-game-site-'));
  execFileSync(join(ROOT, 'scripts', 'build_site.sh'), [siteDir], { stdio: 'pipe' });
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(siteDir, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(siteDir) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

// 開一個 iPhone 尺寸的新頁面，記錄 page error、原生對話框與 404。
// 預設封鎖 service worker，避免它的快取影響其他測試；offline 測試才開啟。
// aiProxy：選用的假 proxy 處理函式。有傳時改寫 js/config.js 讓 AI_PROXY_URL 指向本機的假網址，
// 請求交給 aiProxy(route)；全程不發真實網路請求、不用真實 proxy 網址。
async function openPage({ bank, serviceWorkers = 'block', aiProxy } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers });
  const page = await ctx.newPage();
  const problems = { pageErrors: [], dialogs: [], notFound: [] };
  page.on('pageerror', (e) => problems.pageErrors.push(e.message));
  page.on('dialog', (d) => {
    problems.dialogs.push(d.message());
    d.dismiss();
  });
  page.on('response', (r) => {
    if (r.status() === 404) problems.notFound.push(r.url());
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  if (bank) {
    await ctx.route('**/questions.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(bank) })
    );
  }
  if (aiProxy) {
    await ctx.route('**/js/config.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const CONFIG = { GA_MEASUREMENT_ID: '', AI_PROXY_URL: '${baseUrl}__fake_proxy' };\nexport const APP_NAMESPACE = 'brain-game';\n`,
      })
    );
    await ctx.route('**/__fake_proxy', aiProxy);
  }
  await page.goto(baseUrl);
  await page.waitForSelector('#si');
  return { ctx, page, problems };
}

async function playThrough(page, steps = '4500') {
  await page.fill('#si', steps);
  await page.click('#startBtn');
  for (let i = 0; i < 3; i++) await page.click(`.q-opt[data-i="${i}"]`);
  await page.click('#finishBtn');
  await page.waitForSelector('.share-card');
}

function assertClean(problems) {
  assert.deepEqual(problems.pageErrors, [], 'page errors');
  assert.deepEqual(problems.dialogs, [], '不應出現原生 alert / confirm / prompt');
  assert.deepEqual(problems.notFound, [], '部署內容缺檔（scripts/build_site.sh 清單需更新）');
}

test('e2e [new-user]：首次遊玩完整流程，完成頁顯示統計與分享按鈕', async () => {
  const { ctx, page, problems } = await openPage();
  try {
    await playThrough(page);
    assert.match(await page.textContent('.share-card'), /4,500/);
    assert.match(await page.textContent('.stat-row'), /1\s*累積天數/);
    assert.ok((await page.textContent('#copyBtn')).length > 0);
    assertClean(problems);
  } finally {
    await ctx.close();
  }
});

test('e2e [invalid-steps]：步數不合法時顯示頁內錯誤，輸入後消失', async () => {
  const { ctx, page, problems } = await openPage();
  try {
    await page.fill('#si', '-5');
    await page.click('#startBtn');
    assert.ok(await page.isVisible('#stepErr'));
    assert.match(await page.textContent('#stepErr'), /99,999/);
    await page.fill('#si', '3000');
    assert.ok(!(await page.isVisible('#stepErr')));
    assertClean(problems);
  } finally {
    await ctx.close();
  }
});

test('e2e [retry-flow]：重新挑戰需頁內確認，取消留在完成頁、確定回到步數頁', async () => {
  const { ctx, page, problems } = await openPage();
  try {
    await playThrough(page);
    await page.click('#retryBtn');
    assert.ok(await page.isVisible('#retryConfirm'));
    await page.keyboard.press('Escape');
    assert.ok(!(await page.isVisible('#retryConfirm')));
    assert.ok(await page.isVisible('.share-card'));
    await page.click('#retryBtn');
    await page.click('#retryYes');
    await page.waitForSelector('#si');
    assertClean(problems);
  } finally {
    await ctx.close();
  }
});

test('e2e [xss]：題庫中的惡意字串只會顯示為文字，不會被執行', async () => {
  const payload = '<img src=x onerror="window.__xss=1">';
  const evil = { type: '常識', q: `${payload}？`, a: payload, opts: [payload, '甲', '乙', '丙'] };
  const pool = Array.from({ length: 3 }, (_, i) => ({ ...evil, q: `${payload} 第${i}題？` }));
  const bank = { hard: pool, medium: pool, easy: pool, super_easy: pool };
  const { ctx, page, problems } = await openPage({ bank });
  try {
    await page.fill('#si', '4500');
    await page.click('#startBtn');
    await page.waitForSelector('.q-text');
    assert.ok((await page.textContent('.q-text')).includes('<img'));
    for (let i = 0; i < 3; i++) await page.click(`.q-opt[data-i="${i}"]`);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.q-text img, .q-opt img').count(), 0);
    assert.deepEqual(problems.pageErrors, []);
    assert.deepEqual(problems.dialogs, []);
  } finally {
    await ctx.close();
  }
});

test('e2e [xl-font]：特大字體下無水平捲動', async () => {
  const { ctx, page, problems } = await openPage();
  try {
    await page.click('button[data-scale="1.3"]');
    await playThrough(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.equal(overflow, 0);
    assertClean(problems);
  } finally {
    await ctx.close();
  }
});

test('e2e [site-files]：index.html 引用的本機檔案（含 og:image）都在部署內容中', () => {
  const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href|content)="(?:\.\/|https:\/\/lwc1129\.github\.io\/brain-game\/)([^"#?]+)"/g)) {
    refs.add(m[1]);
  }
  assert.ok(refs.size >= 4, `只找到 ${refs.size} 個引用`);
  for (const ref of refs) assert.ok(existsSync(join(siteDir, ref)), `部署內容缺少 ${ref}`);
});

test('e2e [offline]：載入過一次後，沒有網路也能開啟並玩完一輪', async () => {
  const { ctx, page, problems } = await openPage({ serviceWorkers: 'allow' });
  try {
    // service worker 沒註冊成功時 ready 永遠不會 resolve；限時等待，讓測試失敗而不是卡住。
    const ready = await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 10000)),
      ])
    );
    assert.ok(ready, 'service worker 未在 10 秒內就緒（sw.js 是否有註冊？）');
    // 第一次載入時 SW 尚未接管頁面；重新整理一次讓它接管。
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#si');
    await playThrough(page);
    assert.match(await page.textContent('.share-card'), /4,500/);
    assert.deepEqual(problems.pageErrors, []);
    assert.deepEqual(problems.dialogs, []);
  } finally {
    await ctx.close();
  }
});

test('e2e [pwa-precache]：sw.js 的 PRECACHE 涵蓋所有網站檔案，且每項都存在', () => {
  const sw = readFileSync(join(siteDir, 'sw.js'), 'utf8');
  const list = JSON.parse(
    sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']')
  );
  const entries = new Set(list.map((p) => p.replace(/^\.\//, '')));
  for (const e of entries) {
    if (e === '') continue;
    assert.ok(existsSync(join(siteDir, e)), `PRECACHE 列了不存在的檔案：${e}`);
  }
  const walk = (dir) =>
    readdirSync(join(siteDir, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]
    );
  const manifestIcons = JSON.parse(readFileSync(join(siteDir, 'manifest.webmanifest'), 'utf8')).icons.map((i) => i.src);
  for (const f of [...walk('js'), ...walk('css'), 'index.html', 'questions.json', 'manifest.webmanifest', ...manifestIcons]) {
    assert.ok(entries.has(f), `${f} 沒有列在 sw.js 的 PRECACHE，離線時會缺檔`);
  }
});

test('e2e [pwa-manifest]：manifest 圖示存在且尺寸正確，頁面有連結 manifest', () => {
  const manifest = JSON.parse(readFileSync(join(siteDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  const sizes = new Set();
  for (const icon of manifest.icons) {
    const buf = readFileSync(join(siteDir, icon.src));
    // PNG IHDR：寬高位於 byte 16–23
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} 實際尺寸 ${w}x${h}`);
    sizes.add(icon.sizes);
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'), '可安裝需要 192 與 512 圖示');
  const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="manifest" href="./manifest.webmanifest">'));
});

test('e2e [double-start]：題庫還在下載時連按開始，只會出一次題', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    // 讓題庫晚 1.5 秒才回應，模擬慢網路下按開始時題庫還沒到
    await ctx.route('**/questions.json', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(baseUrl);
    await page.waitForSelector('#si');
    await page.fill('#si', '4500');
    await page.click('#startBtn');
    await page.click('#startBtn', { force: true, timeout: 2000 }).catch(() => {});
    await page.waitForSelector('.q-text', { timeout: 10000 });
    await page.waitForTimeout(2500);
    // 每出一次題，近期出題記錄就多 3 題；連按兩次若都出題會變成 6
    const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('brain-game:recent:easy') || '[]'));
    assert.equal(recent.length, 3, `近期出題記錄有 ${recent.length} 題，代表出題了不只一次`);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('e2e [pwa-prune]：新版 sw.js 啟用時，清掉快取中已不在 PRECACHE 的舊檔', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  try {
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    let version = 1;
    const swSource = readFileSync(join(siteDir, 'sw.js'), 'utf8');
    await ctx.route('**/sw.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: `${swSource}\n// test-version ${version}\n` })
    );
    await page.goto(baseUrl);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready, null, { timeout: 10000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // 模擬某次部署留下、之後已改名刪除的舊檔
    await page.evaluate(async () => {
      const c = await caches.open('brain-game-v1');
      await c.put(new URL('./js/old-module.js', location.href).href, new Response('old'));
    });
    assert.ok(await page.evaluate(async () => !!(await (await caches.open('brain-game-v1')).match('./js/old-module.js'))));
    // 部署新版 sw.js → 瀏覽器安裝並啟用新的 SW
    version = 2;
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
      const sw = reg.installing || reg.waiting;
      if (sw) await new Promise((r) => sw.addEventListener('statechange', () => sw.state === 'activated' && r()));
    });
    const stale = await page.evaluate(async () => !!(await (await caches.open('brain-game-v1')).match('./js/old-module.js')));
    const kept = await page.evaluate(async () => !!(await (await caches.open('brain-game-v1')).match('./js/app.js')));
    assert.equal(stale, false, '已不在 PRECACHE 的舊檔應被清除');
    assert.equal(kept, true, 'PRECACHE 內的檔案應保留');
  } finally {
    await ctx.close();
  }
});

// 三題純算式「計算」題，必須通過 isValidQuestions。假 proxy 立即回應，
// 遠低於 #65 的 SLOW_HINT_AFTER_MS（6 秒）與 FETCH_TIMEOUT_MS（13 秒），不會出現慢速提示或逾時。
const FAKE_AI_QUESTIONS = [
  { type: '計算', q: '3 + 4 = ？', a: '7', opts: ['5', '6', '7', '8'] },
  { type: '計算', q: '12 - 5 = ？', a: '7', opts: ['6', '7', '8', '9'] },
  { type: '計算', q: '6 × 3 = ？', a: '18', opts: ['15', '16', '17', '18'] },
];

test('e2e [ai-success]：AI proxy 回合法三題時顯示 AI 出題並能玩完', async () => {
  let calls = 0;
  const { ctx, page, problems } = await openPage({
    aiProxy: (route) => {
      calls++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ questions: FAKE_AI_QUESTIONS }) });
    },
  });
  try {
    await page.fill('#si', '4500');
    await page.click('#startBtn');
    await page.waitForSelector('.q-text');
    assert.match(await page.textContent('.q-tag'), /🤖 AI 出題/);
    const texts = await page.locator('.q-text').allTextContents();
    assert.deepEqual(texts, FAKE_AI_QUESTIONS.map((q) => q.q));
    for (let i = 0; i < 3; i++) await page.click(`.q-opt[data-i="${i}"]`);
    await page.click('#finishBtn');
    await page.waitForSelector('.share-card');
    assert.ok(calls >= 1, '假 proxy 沒有被呼叫');
    assertClean(problems);
  } finally {
    await ctx.close();
  }
});

test('e2e [ai-fallback]：AI proxy 回 502 時退回題庫出題並能玩完', async () => {
  let calls = 0;
  const { ctx, page, problems } = await openPage({
    aiProxy: (route) => {
      calls++;
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"generation failed"}' });
    },
  });
  try {
    await page.fill('#si', '4500');
    await page.click('#startBtn');
    await page.waitForSelector('.q-text');
    assert.match(await page.textContent('.q-tag'), /📚 題庫出題/);
    for (let i = 0; i < 3; i++) await page.click(`.q-opt[data-i="${i}"]`);
    await page.click('#finishBtn');
    await page.waitForSelector('.share-card');
    assert.ok(calls >= 1, '假 proxy 沒有被呼叫');
    assert.deepEqual(problems.pageErrors, []);
  } finally {
    await ctx.close();
  }
});

test('e2e [slow-network]：載入過一次後，網路很慢時 15 秒內用快取開啟並能玩完', async () => {
  const { ctx, page, problems } = await openPage({ serviceWorkers: 'allow' });
  try {
    const ready = await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 10000)),
      ])
    );
    assert.ok(ready, 'service worker 未在 10 秒內就緒');
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
    // 模擬弱訊號：所有本機請求延遲 10 秒才送出（遠大於 sw.js 的 NETWORK_TIMEOUT_MS）。
    let delayed = 0;
    await ctx.route(/^http:\/\/127\.0\.0\.1/, async (route) => {
      delayed++;
      await new Promise((r) => setTimeout(r, 10000));
      await route.continue().catch(() => {});
    });
    const t0 = Date.now();
    await page.reload({ waitUntil: 'commit' });
    // 每個請求在 sw.js 各自等 NETWORK_TIMEOUT_MS（3 秒）才改用快取，模組載入鏈有 4 層，
    // 所以實測約 12.5 秒（原本的 sw.js 約 40 秒）。
    await page.waitForSelector('#si', { timeout: 15000 });
    const elapsed = Date.now() - t0;
    assert.ok(delayed > 0, 'route 沒有攔到任何請求（攔不到 service worker 發出的請求？）');
    assert.ok(elapsed < 15000, `花了 ${elapsed}ms 才出現畫面`);
    await playThrough(page);
    assert.deepEqual(problems.pageErrors, []);
    assert.deepEqual(problems.dialogs, []);
  } finally {
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await ctx.close();
  }
});
