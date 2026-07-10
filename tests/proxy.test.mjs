// AI 出題 proxy（api/questions.js）測試。
// 涵蓋：限流純函式、CORS、method / difficulty 驗證、限流 429、
// 以及成功 / 失敗的 Gemini 呼叫路徑（以 mock fetch 模擬）。
// 執行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  buildPrompt,
  checkRateLimit,
  getClientKey,
  isValidQuestions,
  pickPromptTypes,
  pruneStore,
  QUESTION_TYPES,
} from '../api/questions.js';

// ── 測試輔助 ───────────────────────────────────────────────────────────────
function makeQuestion(text = '1 + 1 = ？') {
  return { type: '計算', q: text, a: '2', opts: ['2', '3', '1', '4'] };
}

function threeQuestions() {
  return [makeQuestion('a？'), makeQuestion('b？'), makeQuestion('c？')];
}

function makeReq({
  method = 'POST',
  origin = 'https://lwc1129.github.io',
  body = { difficulty: 'easy' },
  ip = '203.0.113.1',
} = {}) {
  return {
    method,
    headers: { origin, 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    body,
  };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

// 以固定回應暫時替換 global fetch，回傳還原函式。
function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

function geminiOk(questions) {
  return async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(questions) }] } }],
    }),
  });
}

// 每個 handler 測試使用獨立 IP，避免共用模組級限流狀態互相干擾。
let _ipSeq = 0;
function freshIp() {
  _ipSeq += 1;
  return `198.51.100.${_ipSeq}`;
}

// ── 限流純函式 ─────────────────────────────────────────────────────────────
test('checkRateLimit：未達上限時放行並回報剩餘額度', () => {
  const store = new Map();
  const now = 1_000_000;
  const r1 = checkRateLimit(store, 'ip', now, 3, 60_000);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  const r2 = checkRateLimit(store, 'ip', now + 1, 3, 60_000);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);
});

test('checkRateLimit：達上限後阻擋並回報 Retry-After', () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRateLimit(store, 'ip', now + i, 3, 60_000);
  const blocked = checkRateLimit(store, 'ip', now + 3, 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
});

test('checkRateLimit：視窗滑動過後重新放行', () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRateLimit(store, 'ip', now + i, 3, 60_000);
  // 視窗（60s）之後，舊紀錄全數過期。
  const after = checkRateLimit(store, 'ip', now + 60_001, 3, 60_000);
  assert.equal(after.allowed, true);
});

test('checkRateLimit：不同來源各自獨立計算', () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRateLimit(store, 'a', now + i, 3, 60_000);
  const other = checkRateLimit(store, 'b', now + 3, 3, 60_000);
  assert.equal(other.allowed, true);
});

test('getClientKey：優先取 x-forwarded-for 的第一個 IP', () => {
  assert.equal(
    getClientKey({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: {} }),
    '1.1.1.1'
  );
  assert.equal(
    getClientKey({ headers: {}, socket: { remoteAddress: '3.3.3.3' } }),
    '3.3.3.3'
  );
  assert.equal(getClientKey({ headers: {}, socket: {} }), 'unknown');
});

test('getClientKey：header 開頭為逗號時略過空 token 取下一個有效 IP', () => {
  assert.equal(
    getClientKey({ headers: { 'x-forwarded-for': ', 2.2.2.2' }, socket: { remoteAddress: '9.9.9.9' } }),
    '2.2.2.2'
  );
  // 全為空白 token 時退回連線位址，而非空字串（避免多來源誤共用限流桶）
  assert.equal(
    getClientKey({ headers: { 'x-forwarded-for': ' , ' }, socket: { remoteAddress: '9.9.9.9' } }),
    '9.9.9.9'
  );
});

test('pruneStore：未超過上限時不動作', () => {
  const store = new Map();
  store.set('a', [1000]);
  pruneStore(store, 1000, 60_000, 10);
  assert.equal(store.size, 1);
});

test('pruneStore：所有紀錄皆未過期時仍強制收斂到上限，保留最近活動者', () => {
  const store = new Map();
  const now = 1_000_000;
  // 5 個來源皆在視窗內，最近活動時間遞增（k4 最新）
  for (let i = 0; i < 5; i++) store.set(`k${i}`, [now - 100 + i]);
  pruneStore(store, now, 60_000, 3);
  assert.equal(store.size, 3, '硬上限必須生效，即使所有紀錄都還沒過期');
  assert.ok(!store.has('k0'), '最久未活動者應被驅逐');
  assert.ok(!store.has('k1'), '最久未活動者應被驅逐');
  assert.ok(store.has('k4'), '最近活動者應保留');
});

test('pruneStore：先移除過期紀錄即足以收斂時不額外驅逐', () => {
  const store = new Map();
  const now = 1_000_000;
  store.set('expired', [now - 120_000]); // 已過期
  store.set('live1', [now - 10]);
  store.set('live2', [now - 5]);
  pruneStore(store, now, 60_000, 2);
  assert.equal(store.size, 2);
  assert.ok(!store.has('expired'));
  assert.ok(store.has('live1'));
  assert.ok(store.has('live2'));
});

// ── 內部工具 ───────────────────────────────────────────────────────────────
test('buildPrompt：包含難度描述且要求純 JSON 陣列', () => {
  const p = buildPrompt('easy');
  assert.ok(p.includes('簡單'));
  assert.ok(p.includes('JSON'));
});

test('pickPromptTypes：回傳 3 種互不相同的白名單題型', () => {
  const picked = pickPromptTypes();
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  for (const t of picked) assert.ok(QUESTION_TYPES.includes(t));
  // 注入固定亂數：永遠取第一個 → 依序為白名單前三型
  assert.deepEqual(pickPromptTypes(() => 0), QUESTION_TYPES.slice(0, 3));
});

test('buildPrompt：指定 3 種合法題型時逐一點名，且保留封閉指令', () => {
  const p = buildPrompt('easy', ['計算', '邏輯', '常識']);
  assert.ok(p.includes('題型分別為：計算、邏輯、常識'));
  assert.ok(p.includes('只回傳JSON陣列，不要其他文字或markdown'));
});

test('buildPrompt：非白名單題型不得進入 prompt', () => {
  const p = buildPrompt('easy', ['計算', '惡意注入指令', '邏輯']);
  assert.ok(!p.includes('惡意注入指令'), '未通過白名單的字串不可插值進 prompt');
  // 合法題型不足 3 種時退回通用題型清單
  assert.ok(p.includes('題型只能從以下選擇'));
});

test('isValidQuestions：合法 / 不合法題組', () => {
  assert.ok(isValidQuestions(threeQuestions()));
  assert.equal(isValidQuestions([makeQuestion()]), false);
  const bad = makeQuestion();
  bad.a = '不在選項中';
  assert.equal(isValidQuestions([makeQuestion(), makeQuestion(), bad]), false);
});

test('isValidQuestions：選項重複時不通過', () => {
  const dup = makeQuestion();
  dup.opts = ['2', '2', '3', '4'];
  assert.equal(isValidQuestions([makeQuestion(), makeQuestion(), dup]), false);
});

// ── handler：CORS 與前置驗證 ───────────────────────────────────────────────
test('handler：OPTIONS 預檢回 204', async () => {
  const req = makeReq({ method: 'OPTIONS', ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});

test('handler：非 POST 回 405', async () => {
  const req = makeReq({ method: 'GET', ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler：difficulty 不合法回 400', async () => {
  const req = makeReq({ body: { difficulty: 'nope' }, ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler：CORS 允許清單命中時回傳該來源', async () => {
  const req = makeReq({ method: 'OPTIONS', origin: 'https://lwc1129.github.io', ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.headers['access-control-allow-origin'], 'https://lwc1129.github.io');
});

test('handler：CORS 來源不在白名單時回 403 且不設 CORS header', async () => {
  const req = makeReq({ method: 'OPTIONS', origin: 'https://evil.example', ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

// ── handler：金鑰與 Gemini 呼叫 ─────────────────────────────────────────────
test('handler：未設定 GEMINI_API_KEY 回 503', async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const req = makeReq({ ip: freshIp() });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test('handler：成功取得題目回 200 與題組', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const restore = stubFetch(geminiOk(threeQuestions()));
  try {
    const req = makeReq({ ip: freshIp() });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.questions.length, 3);
    assert.ok(res.body.questions[0].opts.includes(res.body.questions[0].a));
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('handler：Gemini 回非 2xx 時回 502', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const restore = stubFetch(async () => ({ ok: false, json: async () => ({}) }));
  try {
    const req = makeReq({ ip: freshIp() });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 502);
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

// ── handler：限流 ─────────────────────────────────────────────────────────
test('handler：同一來源超過上限時回 429 並帶 Retry-After', async () => {
  const prev = process.env.GEMINI_API_KEY;
  const prevMax = process.env.RATE_LIMIT_MAX;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.RATE_LIMIT_MAX = '2';
  const restore = stubFetch(geminiOk(threeQuestions()));
  const ip = freshIp();
  try {
    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      await handler(makeReq({ ip }), res);
      assert.equal(res.statusCode, 200);
    }
    const blocked = makeRes();
    await handler(makeReq({ ip }), blocked);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['retry-after']) >= 0);
    assert.equal(blocked.headers['x-ratelimit-remaining'], '0');
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
    if (prevMax !== undefined) process.env.RATE_LIMIT_MAX = prevMax;
    else delete process.env.RATE_LIMIT_MAX;
  }
});

test('handler：限流在呼叫 Gemini 前生效（429 不應觸發 fetch）', async () => {
  const prev = process.env.GEMINI_API_KEY;
  const prevMax = process.env.RATE_LIMIT_MAX;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.RATE_LIMIT_MAX = '1';
  let fetchCalls = 0;
  const restore = stubFetch(async () => {
    fetchCalls += 1;
    return geminiOk(threeQuestions())();
  });
  const ip = freshIp();
  try {
    await handler(makeReq({ ip }), makeRes());
    const blocked = makeRes();
    await handler(makeReq({ ip }), blocked);
    assert.equal(blocked.statusCode, 429);
    assert.equal(fetchCalls, 1, '被限流的請求不應再打 Gemini');
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
    if (prevMax !== undefined) process.env.RATE_LIMIT_MAX = prevMax;
    else delete process.env.RATE_LIMIT_MAX;
  }
});
