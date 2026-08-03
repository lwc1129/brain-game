// js/ai.js 單元測試（mock fetch 與 localStorage，不發真實網路請求）。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';

const PROXY_URL = 'https://test-proxy.example/api/questions';
const TODAY = '2026-06-10';

function makeQuestion(text = '1 + 1 = ？') {
  return { type: '計算', q: text, a: '2', opts: ['2', '3', '1', '4'] };
}

function threeQuestions() {
  return [makeQuestion('a？'), makeQuestion('b？'), makeQuestion('c？')];
}

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

let restoreFetch = null;
let prevProxyUrl = '';

beforeEach(() => {
  prevProxyUrl = CONFIG.AI_PROXY_URL;
  CONFIG.AI_PROXY_URL = PROXY_URL;
  installLocalStorage();
});

afterEach(async () => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
  CONFIG.AI_PROXY_URL = prevProxyUrl;
  const { clearInflight } = await import('../js/ai.js');
  clearInflight();
});

test('aiEnabled：依 CONFIG.AI_PROXY_URL 開關', async () => {
  const { aiEnabled } = await import('../js/ai.js');
  assert.equal(aiEnabled(), true);
  CONFIG.AI_PROXY_URL = '';
  assert.equal(aiEnabled(), false);
});

test('fetchAiQuestions：cache hit 不發請求', async () => {
  let fetchCalls = 0;
  restoreFetch = stubFetch(async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ questions: threeQuestions() }) };
  });
  const { writeAiCache } = await import('../js/storage.js');
  const { fetchAiQuestions } = await import('../js/ai.js');
  writeAiCache(TODAY, 'easy', threeQuestions());
  const result = await fetchAiQuestions(TODAY, 'easy');
  assert.equal(fetchCalls, 0);
  assert.equal(result.length, 3);
});

test('fetchAiQuestions：成功取得並寫入 cache', async () => {
  restoreFetch = stubFetch(async () => ({
    ok: true,
    json: async () => ({ questions: threeQuestions() }),
  }));
  const { fetchAiQuestions } = await import('../js/ai.js');
  const { readAiCache } = await import('../js/storage.js');
  const result = await fetchAiQuestions(TODAY, 'easy');
  assert.equal(result.length, 3);
  assert.ok(readAiCache(TODAY, 'easy'));
});

test('fetchAiQuestions：inflight dedup 並發只打一個請求', async () => {
  let fetchCalls = 0;
  let resolveFetch;
  restoreFetch = stubFetch(
    () =>
      new Promise((resolve) => {
        fetchCalls += 1;
        resolveFetch = () =>
          resolve({ ok: true, json: async () => ({ questions: threeQuestions() }) });
      })
  );
  const { fetchAiQuestions } = await import('../js/ai.js');
  const p1 = fetchAiQuestions(TODAY, 'medium');
  const p2 = fetchAiQuestions(TODAY, 'medium');
  assert.equal(fetchCalls, 1);
  resolveFetch();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, r2);
});

test('fetchAiQuestions：非 2xx 回 null', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (msg) => errors.push(msg);
  restoreFetch = stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  try {
    const { fetchAiQuestions } = await import('../js/ai.js');
    const result = await fetchAiQuestions(TODAY, 'easy');
    assert.equal(result, null);
    assert.ok(errors.some((e) => e.includes('fetchFromProxy')));
  } finally {
    console.error = orig;
  }
});

test('fetchAiQuestions：驗證失敗回 null', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (msg) => errors.push(msg);
  const bad = makeQuestion();
  bad.a = '不在選項中';
  restoreFetch = stubFetch(async () => ({
    ok: true,
    json: async () => ({ questions: [bad, makeQuestion(), makeQuestion()] }),
  }));
  try {
    const { fetchAiQuestions } = await import('../js/ai.js');
    const result = await fetchAiQuestions(TODAY, 'easy');
    assert.equal(result, null);
    assert.ok(errors.some((e) => e.includes('invalid questions')));
  } finally {
    console.error = orig;
  }
});

test('fetchAiQuestions：timeout abort 回 null 並記錄 log', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (msg) => errors.push(msg);
  restoreFetch = stubFetch(async () => {
    throw new DOMException('The operation was aborted', 'AbortError');
  });
  try {
    const { fetchAiQuestions } = await import('../js/ai.js');
    const result = await fetchAiQuestions(TODAY, 'hard');
    assert.equal(result, null);
    assert.ok(errors.some((e) => e.includes('fetchFromProxy')));
  } finally {
    console.error = orig;
  }
});
