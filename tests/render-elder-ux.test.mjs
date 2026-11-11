// 長者體驗相關的 render 純函式測試：分享文字、分享按鈕、頁內確認與錯誤提示。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompleteHtml,
  buildShareText,
  SHARE_URL,
  shareButtonLabel,
} from '../js/render/complete.js';
import { buildStepHtml, STEP_ERROR_MSG } from '../js/render/step.js';
import { MAX_STEPS } from '../js/logic.js';

const data = { steps: 5234, questions: [{}, {}, {}], answers: [], aiGenerated: false };
const hist = { total: 100, streak: 3, lastDate: '2026-06-10', log: [], days: 4 };
const diff = { key: 'easy', label: '簡單 👍' };

test('buildShareText：最後一行是網址，家人收到可直接點開', () => {
  const txt = buildShareText('2026-06-10', data, 2, '🟢 🟢 🔴');
  assert.equal(txt.split('\n').at(-1), SHARE_URL);
  assert.ok(txt.includes('5,234 步'));
  assert.ok(txt.includes('2/3 題'));
});

test('SHARE_URL：與 index.html 的 canonical 網址一致', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`<link rel="canonical" href="${SHARE_URL}">`));
});

test('shareButtonLabel：支援系統分享時顯示「分享給家人」，否則顯示「複製」', () => {
  assert.equal(shareButtonLabel(true), '📤 分享給家人');
  assert.equal(shareButtonLabel(false), '📋 複製分享文字');
});

test('buildCompleteHtml：重新挑戰的確認面板預設隱藏，並寫出會扣除的分數', () => {
  const html = buildCompleteHtml('2026-06-10', data, 3, 35, diff, hist, '🟢 🟢 🟢');
  assert.match(html, /id="retryConfirm"[^>]*hidden/);
  assert.ok(html.includes('今日得分 +35 將會扣除'));
  assert.ok(html.includes('id="retryYes"'));
  assert.ok(html.includes('id="retryNo"'));
  assert.match(html, /id="retryBtn"[^>]*aria-expanded="false"/);
});

test('buildCompleteHtml：複製失敗時的備援文字框預設隱藏', () => {
  const html = buildCompleteHtml('2026-06-10', data, 1, 10, diff, hist, '🟢 🔴 🔴');
  assert.match(html, /id="copyFallback"[^>]*hidden/);
  assert.ok(html.includes('<textarea id="copyFallbackText" readonly'));
});

test('buildStepHtml：含頁內錯誤提示區塊（role="alert"），預設為空', () => {
  const html = buildStepHtml({ total: 0, streak: 0, lastDate: null, log: [] });
  assert.match(html, /<div id="stepErr" class="form-error" role="alert"><\/div>/);
});

test('STEP_ERROR_MSG：寫明合法範圍，而不是只說「無效」', () => {
  assert.ok(STEP_ERROR_MSG.includes('0'));
  assert.ok(STEP_ERROR_MSG.includes(MAX_STEPS.toLocaleString()));
});

test('styles.css：所有字級至少 0.875rem（約 14px）', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0);
  for (const s of sizes) assert.ok(s >= 0.875, `font-size ${s}rem 太小`);
});

test('styles.css：輸入框聚焦時不移除焦點外框', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.ok(!/outline:\s*none/.test(css));
});
