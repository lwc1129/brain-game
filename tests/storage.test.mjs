// js/storage.js 近期出題記錄測試（以記憶體 stub 取代 localStorage）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { RECENT_LIMIT, loadRecentQuestionTexts, recordRecentQuestions } = await import('../js/storage.js');

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
