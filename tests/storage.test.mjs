// js/storage.js 近期出題記錄測試（以記憶體 stub 取代 localStorage）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const {
  RECENT_LIMIT,
  DAILY_KEY_KEEP_DAYS,
  loadHistory,
  loadRecentQuestionTexts,
  loadTodayData,
  pruneOldDailyKeys,
  recordRecentQuestions,
} = await import('../js/storage.js');

// 暫時攔下 console.error（logError 的輸出），回傳被記錄的 JSON 物件。
function captureErrors(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (line) => logs.push(JSON.parse(line));
  try {
    return { result: fn(), logs };
  } finally {
    console.error = orig;
  }
}

const qs = (from, to) => Array.from({ length: to - from }, (_, i) => ({ q: `題目 ${from + i}` }));

beforeEach(() => mem.clear());

test('RECENT_LIMIT：至少涵蓋 80 天（每天 3 題），且小於每難度題庫上限 300', () => {
  assert.ok(RECENT_LIMIT >= 3 * 80);
  assert.ok(RECENT_LIMIT < 300);
});

test('recordRecentQuestions：未達上限時全部保留', () => {
  recordRecentQuestions('easy', qs(0, 100));
  assert.equal(loadRecentQuestionTexts('easy').size, 100);
});

test('recordRecentQuestions：超過上限時只保留最近 RECENT_LIMIT 題，淘汰最舊的', () => {
  recordRecentQuestions('easy', qs(0, RECENT_LIMIT + 10));
  const recent = loadRecentQuestionTexts('easy');
  assert.equal(recent.size, RECENT_LIMIT);
  assert.ok(!recent.has('題目 0'));
  assert.ok(!recent.has('題目 9'));
  assert.ok(recent.has('題目 10'));
  assert.ok(recent.has(`題目 ${RECENT_LIMIT + 9}`));
});

test('recordRecentQuestions：重複出現的題目移到最新，不會被當成最舊淘汰', () => {
  recordRecentQuestions('easy', qs(0, RECENT_LIMIT));
  recordRecentQuestions('easy', [{ q: '題目 0' }]);
  recordRecentQuestions('easy', qs(RECENT_LIMIT, RECENT_LIMIT + 1));
  const recent = loadRecentQuestionTexts('easy');
  assert.equal(recent.size, RECENT_LIMIT);
  assert.ok(recent.has('題目 0'));
  assert.ok(!recent.has('題目 1'));
});

test('recordRecentQuestions：各難度各自記錄，互不影響', () => {
  recordRecentQuestions('easy', qs(0, 5));
  recordRecentQuestions('hard', qs(100, 102));
  assert.equal(loadRecentQuestionTexts('easy').size, 5);
  assert.equal(loadRecentQuestionTexts('hard').size, 2);
  assert.equal(loadRecentQuestionTexts('medium').size, 0);
});

test('loadRecentQuestionTexts：儲存內容損毀時回傳空集合', () => {
  mem.set('brain-game:recent:easy', '{not json');
  const origErr = console.error;
  console.error = () => {};
  try {
    assert.equal(loadRecentQuestionTexts('easy').size, 0);
  } finally {
    console.error = origErr;
  }
});

// ── B4：每日鍵清理 ─────────────────────────────────────────────────────
test('DAILY_KEY_KEEP_DAYS：保留 7 天', () => {
  assert.equal(DAILY_KEY_KEEP_DAYS, 7);
});

test('pruneOldDailyKeys：只刪日期早於 cutoff 的四種每日鍵，其餘不動', () => {
  const old = '2026-11-05';
  const edge = '2026-11-06';
  const keep = [
    `brain-game:today:${edge}`,
    `brain-game:ai-cache:${edge}:easy:v0`,
    `brain-game:ai-flag:ai-cache:${edge}:easy:v0`,
    `brain-game:ai-retry:${edge}`,
    'brain-game:today:2026-11-13',
    'brain-game:history',
    'brain-game:recent:easy',
    'brain-game:font-scale',
    `other-app:today:${old}`,
  ];
  const drop = [
    `brain-game:today:${old}`,
    `brain-game:ai-cache:${old}:hard:v2`,
    `brain-game:ai-flag:ai-cache:${old}:hard:v2`,
    `brain-game:ai-retry:${old}`,
    'brain-game:today:2025-12-31',
  ];
  for (const k of [...keep, ...drop]) mem.set(k, '1');
  pruneOldDailyKeys(edge);
  for (const k of keep) assert.ok(mem.has(k), `應保留 ${k}`);
  for (const k of drop) assert.ok(!mem.has(k), `應刪除 ${k}`);
});

test('pruneOldDailyKeys：localStorage 拋錯時只記 log，不往外拋', () => {
  const orig = globalThis.localStorage;
  globalThis.localStorage = {
    get length() {
      throw new Error('denied');
    },
  };
  try {
    const { logs } = captureErrors(() => pruneOldDailyKeys('2026-11-06'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ctx.op, 'pruneOldDailyKeys');
  } finally {
    globalThis.localStorage = orig;
  }
});

// ── B4：history 形狀檢查 ──────────────────────────────────────────────
const HIST_DEF = { total: 0, streak: 0, lastDate: null, log: [] };

for (const [name, bad] of [
  ['缺 log', { total: 1, streak: 1 }],
  ['log 不是陣列', { total: 1, streak: 1, log: 'x' }],
  ['total 是字串', { total: '1', streak: 1, log: [] }],
]) {
  test(`loadHistory：${name} 時回預設值並記一筆 log`, () => {
    mem.set('brain-game:history', JSON.stringify(bad));
    const { result, logs } = captureErrors(() => loadHistory());
    assert.deepEqual(result, HIST_DEF);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ctx.op, 'loadHistory');
  });
}

test('loadHistory：合法且帶額外欄位（days 等）時照原樣回傳', () => {
  const h = { total: 30, streak: 2, lastDate: '2026-11-12', log: [{ date: '2026-11-12', score: 30 }], days: 5 };
  mem.set('brain-game:history', JSON.stringify(h));
  const { result, logs } = captureErrors(() => loadHistory());
  assert.deepEqual(result, h);
  assert.equal(logs.length, 0);
});

test('loadHistory：沒有資料時回預設值且不記 log', () => {
  const { result, logs } = captureErrors(() => loadHistory());
  assert.deepEqual(result, HIST_DEF);
  assert.equal(logs.length, 0);
});

// ── B4：today 形狀檢查 ────────────────────────────────────────────────
const TODAY_KEY = 'brain-game:today:2026-11-13';
const TODAY_DEF = { steps: null, questions: null, answers: [], completed: false, aiGenerated: false };

for (const [name, bad] of [
  ['questions 長度 2', { steps: 5000, questions: [{}, {}], answers: [] }],
  ['questions 是字串', { steps: 5000, questions: 'abc', answers: [] }],
  ['整份是陣列', [1, 2, 3]],
  ['answers 不是陣列', { steps: 5000, questions: null, answers: 'x' }],
]) {
  test(`loadTodayData：${name} 時回預設值並記一筆 log`, () => {
    mem.set(TODAY_KEY, JSON.stringify(bad));
    const { result, logs } = captureErrors(() => loadTodayData('2026-11-13'));
    assert.deepEqual(result, TODAY_DEF);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ctx.op, 'loadTodayData');
  });
}

test('loadTodayData：questions 為 null 的合法資料照常與預設值合併', () => {
  mem.set(TODAY_KEY, JSON.stringify({ steps: 6000, questions: null }));
  const { result, logs } = captureErrors(() => loadTodayData('2026-11-13'));
  assert.deepEqual(result, { ...TODAY_DEF, steps: 6000 });
  assert.equal(logs.length, 0);
});

test('loadTodayData：三題的合法資料照常合併', () => {
  const saved = { steps: 6000, questions: [{ q: 'a' }, { q: 'b' }, { q: 'c' }], answers: [0], completed: false };
  mem.set(TODAY_KEY, JSON.stringify(saved));
  const { result, logs } = captureErrors(() => loadTodayData('2026-11-13'));
  assert.deepEqual(result, { ...TODAY_DEF, ...saved });
  assert.equal(logs.length, 0);
});
