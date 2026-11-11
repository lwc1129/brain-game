// 端到端 smoke test：以真實瀏覽器操作 scripts/build_site.sh 產出的網站（即實際部署內容）。
// 不發外部網路請求：題庫由本機 server 提供，Google Fonts 等外部請求一律攔截。
// 執行：node --test --test-concurrency=1 tests/e2e/*.e2e.mjs
// 需要 playwright（CI 以 npm i --no-save 安裝，不寫入 package.json，維持零 runtime 依賴）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
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
async function openPage({ bank } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
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
