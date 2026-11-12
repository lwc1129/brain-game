// AI 出題 proxy（api/questions.js）測試。
// 涵蓋：限流純函式、CORS、method / difficulty 驗證、限流 429、
// 以及成功 / 失敗的 Gemini 呼叫路徑（以 mock fetch 模擬）。
// 執行：node --test tests/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  buildPrompt,
  checkRateLimit,
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_TIMEOUT_MS,
  getClientKey,
  isValidQuestions,
  pickPromptTypes,
  pruneStore,
  QUESTION_CACHE_SETS,
  QUESTION_TYPES,
  RESPONSE_SCHEMA,
  addCachedSet,
  pickCachedSet,
  resetQuestionCache,
  taipeiDateKey,
} from '../api/questions.js';
import { QUESTION_TYPES as LOGIC_QUESTION_TYPES } from '../js/logic.js';

// 題目快取是模組層級狀態，每個測試前重設，避免先前成功的請求讓後面的測試命中快取。
beforeEach(() => resetQuestionCache());

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

test('handler：origin 被拒絕時記錄結構化 warn log', async () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (msg) => logs.push(msg);
  try {
    const req = makeReq({ method: 'POST', origin: 'https://evil.example', ip: freshIp() });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.ctx.origin, 'https://evil.example');
    assert.equal(entry.msg, 'origin not allowed');
  } finally {
    console.warn = orig;
  }
});

test('handler：rate limit 觸發時記錄結構化 warn log', async () => {
  const prev = process.env.GEMINI_API_KEY;
  const prevMax = process.env.RATE_LIMIT_MAX;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.RATE_LIMIT_MAX = '1';
  const restore = stubFetch(geminiOk(threeQuestions()));
  const ip = freshIp();
  const logs = [];
  const orig = console.warn;
  console.warn = (msg) => logs.push(msg);
  try {
    await handler(makeReq({ ip }), makeRes());
    const blocked = makeRes();
    await handler(makeReq({ ip }), blocked);
    assert.equal(blocked.statusCode, 429);
    const rlLog = logs.find((m) => {
      try {
        return JSON.parse(m).msg === 'rate limit exceeded';
      } catch {
        return false;
      }
    });
    assert.ok(rlLog, '應有 rate limit warn log');
    const entry = JSON.parse(rlLog);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.ctx.clientKey, ip);
    assert.equal(entry.ctx.remaining, 0);
  } finally {
    restore();
    console.warn = orig;
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
    if (prevMax !== undefined) process.env.RATE_LIMIT_MAX = prevMax;
    else delete process.env.RATE_LIMIT_MAX;
  }
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
  const errors = [];
  const origErr = console.error;
  console.error = (msg) => errors.push(msg);
  const restore = stubFetch(async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    json: async () => ({}),
  }));
  try {
    const req = makeReq({ ip: freshIp() });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 502);
    const entry = JSON.parse(errors.find((m) => m.includes('Gemini 回應非 2xx')) || '{}');
    assert.equal(entry.level, 'error');
    assert.equal(entry.ctx.status, 503);
    assert.equal(entry.ctx.statusText, 'Service Unavailable');
    assert.equal(entry.ctx.diffKey, 'easy');
  } finally {
    restore();
    console.error = origErr;
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

// ── handler：difficulty 與 origin 邊界 ─────────────────────────────────────
for (const diff of ['hard', 'medium', 'easy', 'super_easy']) {
  test(`handler：合法 difficulty「${diff}」回 200`, async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const restore = stubFetch(geminiOk(threeQuestions()));
    try {
      const res = makeRes();
      await handler(makeReq({ body: { difficulty: diff }, ip: freshIp() }), res);
      assert.equal(res.statusCode, 200);
    } finally {
      restore();
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
      else delete process.env.GEMINI_API_KEY;
    }
  });
}

test('handler：缺省 difficulty 回 400', async () => {
  const req = makeReq({ body: {}, ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler：POST 來源不在白名單時回 403', async () => {
  const req = makeReq({ method: 'POST', origin: 'https://evil.example', ip: freshIp() });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
});

test('handler：Gemini 回傳 garbage JSON 時回 502', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'not json at all' }] } }],
    }),
  }));
  try {
    const res = makeRes();
    await handler(makeReq({ ip: freshIp() }), res);
    assert.equal(res.statusCode, 502);
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('handler：Gemini 回傳結構不符時回 502', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const bad = makeQuestion();
  bad.a = '不在選項中';
  const restore = stubFetch(geminiOk([bad, makeQuestion(), makeQuestion()]));
  try {
    const res = makeRes();
    await handler(makeReq({ ip: freshIp() }), res);
    assert.equal(res.statusCode, 502);
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('handler：Gemini 回傳 markdown 包裝的 JSON 時回 200', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const wrapped = '```json\n' + JSON.stringify(threeQuestions()) + '\n```';
  const restore = stubFetch(async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: wrapped }] } }],
    }),
  }));
  try {
    const res = makeRes();
    await handler(makeReq({ ip: freshIp() }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.questions.length, 3);
  } finally {
    restore();
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

// ── handler：Gemini 呼叫例外（逾時 / 網路錯誤）──────────────────────────
async function runWithFetch(impl) {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const errors = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(msg);
  console.log = () => {};
  const restore = stubFetch(impl);
  try {
    const res = makeRes();
    await handler(makeReq({ ip: freshIp() }), res);
    return { res, errors };
  } finally {
    restore();
    console.error = origErr;
    console.log = origLog;
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
}

test('handler：Gemini fetch 逾時時回 502 並記錄 TimeoutError', async () => {
  const { res, errors } = await runWithFetch(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: 'generation failed' });
  const entry = JSON.parse(errors.find((m) => m.includes('Gemini 呼叫例外')) || '{}');
  assert.equal(entry.level, 'error');
  assert.ok(entry.ts);
  assert.equal(entry.ctx.diffKey, 'easy');
  assert.equal(entry.ctx.errorName, 'TimeoutError');
  assert.equal(entry.ctx.timeoutMs, GEMINI_TIMEOUT_MS);
});

test('handler：Gemini 網路錯誤時回 502 而非未處理例外', async () => {
  const { res, errors } = await runWithFetch(async () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(res.statusCode, 502);
  const entry = JSON.parse(errors.find((m) => m.includes('Gemini 呼叫例外')) || '{}');
  assert.equal(entry.ctx.errorName, 'TypeError');
  assert.equal(entry.ctx.error, 'fetch failed');
});

test('handler：Gemini 回應 body 不是 JSON 時回 502', async () => {
  const { res, errors } = await runWithFetch(async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  }));
  assert.equal(res.statusCode, 502);
  assert.ok(errors.some((m) => m.includes('Gemini 呼叫例外')));
});

test('handler：呼叫 Gemini 時帶上逾時 signal', async () => {
  let seenSignal;
  const { res } = await runWithFetch(async (_url, init) => {
    seenSignal = init?.signal;
    return geminiOk(threeQuestions())();
  });
  assert.equal(res.statusCode, 200);
  assert.ok(seenSignal instanceof AbortSignal);
  assert.equal(seenSignal.aborted, false);
});

test('GEMINI_TIMEOUT_MS：必須小於前端 FETCH_TIMEOUT_MS（8000ms）', () => {
  assert.ok(GEMINI_TIMEOUT_MS > 0);
  assert.ok(GEMINI_TIMEOUT_MS < 8000);
});

// ── Gemini 請求設定與 prompt 品質 ─────────────────────────────────────────
test('QUESTION_TYPES：proxy 與前端共用同一份白名單', () => {
  assert.equal(QUESTION_TYPES, LOGIC_QUESTION_TYPES);
});

test('handler：Gemini 請求將 thinking 降到最低、放寬輸出上限並帶 responseSchema', async () => {
  let body;
  const { res } = await runWithFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return geminiOk(threeQuestions())();
  });
  assert.equal(res.statusCode, 200);
  const cfg = body.generationConfig;
  assert.equal(cfg.maxOutputTokens, GEMINI_MAX_OUTPUT_TOKENS);
  assert.ok(GEMINI_MAX_OUTPUT_TOKENS >= 1024);
  // Gemini 3 系列已棄用 thinkingBudget（帶上會回 400），改用 thinkingLevel。
  assert.deepEqual(cfg.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.ok(!('thinkingBudget' in cfg.thinkingConfig));
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.deepEqual(cfg.responseSchema, RESPONSE_SCHEMA);
});

test('handler：Gemini 請求打到 gemini-3.5-flash-lite 模型端點', async () => {
  let calledUrl;
  const { res } = await runWithFetch(async (url) => {
    calledUrl = url;
    return geminiOk(threeQuestions())();
  });
  assert.equal(res.statusCode, 200);
  assert.ok(String(calledUrl).includes('/models/gemini-3.5-flash-lite:generateContent'));
  assert.ok(!String(calledUrl).includes('gemini-2.5-flash'));
});

test('RESPONSE_SCHEMA：3 題、4 選項、題型限白名單、必填欄位齊全', () => {
  assert.equal(RESPONSE_SCHEMA.type, 'ARRAY');
  assert.equal(RESPONSE_SCHEMA.minItems, 3);
  assert.equal(RESPONSE_SCHEMA.maxItems, 3);
  const item = RESPONSE_SCHEMA.items;
  assert.deepEqual(item.required, ['type', 'q', 'a', 'opts']);
  assert.deepEqual(item.properties.type.enum, QUESTION_TYPES);
  assert.equal(item.properties.opts.minItems, 4);
  assert.equal(item.properties.opts.maxItems, 4);
});

test('buildPrompt：困難題不要求「技術」題目，強調用字淺白', () => {
  const p = buildPrompt('hard');
  assert.ok(!p.includes('技術'));
  assert.ok(p.includes('淺白'));
});

test('buildPrompt：四個難度描述互不相同', () => {
  const prompts = ['hard', 'medium', 'easy', 'super_easy'].map((d) => buildPrompt(d, []));
  assert.equal(new Set(prompts).size, 4);
});

test('handler：Gemini 回傳算錯的純算式題時回 502', async () => {
  const wrong = { type: '計算', q: '7 × 8 = ？', a: '54', opts: ['54', '56', '58', '64'] };
  const { res, errors } = await runWithFetch(geminiOk([wrong, makeQuestion('b？'), makeQuestion('c？')]));
  assert.equal(res.statusCode, 502);
  assert.ok(errors.some((m) => m.includes('isValidQuestions 驗證失敗')));
});

// ── 題目快取 ─────────────────────────────────────────────────────────────
test('taipeiDateKey：以台灣時間換日（UTC 16:00 已是台灣隔天）', () => {
  assert.equal(taipeiDateKey(new Date('2026-06-10T15:59:59Z')), '2026-06-10');
  assert.equal(taipeiDateKey(new Date('2026-06-10T16:00:00Z')), '2026-06-11');
});

test('pickCachedSet：題組未累積滿時回傳 null，滿了才隨機挑一組', () => {
  const store = new Map();
  const key = '2026-06-10:easy';
  assert.equal(pickCachedSet(store, key, 2), null);
  addCachedSet(store, key, '2026-06-10', ['a'], 2);
  assert.equal(pickCachedSet(store, key, 2), null);
  addCachedSet(store, key, '2026-06-10', ['b'], 2);
  assert.deepEqual(pickCachedSet(store, key, 2, () => 0), ['a']);
  assert.deepEqual(pickCachedSet(store, key, 2, () => 0.99), ['b']);
});

test('addCachedSet：超過上限不再加入，且會清掉非今天的舊鍵', () => {
  const store = new Map([['2026-06-09:easy', [['old']]]]);
  for (let i = 0; i < 4; i++) addCachedSet(store, '2026-06-10:easy', '2026-06-10', [String(i)], 3);
  assert.equal(store.get('2026-06-10:easy').length, 3);
  assert.ok(!store.has('2026-06-09:easy'));
});

function countingGemini() {
  let calls = 0;
  let n = 0;
  const impl = async () => {
    calls += 1;
    n += 1;
    return geminiOk([makeQuestion(`${n}a？`), makeQuestion(`${n}b？`), makeQuestion(`${n}c？`)])();
  };
  return { impl, calls: () => calls };
}

async function callHandler(difficulty = 'easy') {
  const res = makeRes();
  await handler(makeReq({ ip: freshIp(), body: { difficulty } }), res);
  return res;
}

test('handler：累積滿 QUESTION_CACHE_SETS 組後，同難度不再呼叫 Gemini 並標記 X-Cache: HIT', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const origLog = console.log;
  const logs = [];
  console.log = (m) => logs.push(m);
  const g = countingGemini();
  const restore = stubFetch(g.impl);
  try {
    for (let i = 0; i < QUESTION_CACHE_SETS; i++) {
      const res = await callHandler('easy');
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['x-cache'], 'MISS');
    }
    assert.equal(g.calls(), QUESTION_CACHE_SETS);
    const hit = await callHandler('easy');
    assert.equal(hit.statusCode, 200);
    assert.equal(hit.headers['x-cache'], 'HIT');
    assert.equal(g.calls(), QUESTION_CACHE_SETS, '命中快取不應再呼叫 Gemini');
    assert.equal(hit.body.questions.length, 3);
    const entry = JSON.parse(logs.find((m) => m.includes('題目快取命中')));
    assert.equal(entry.level, 'info');
    assert.equal(entry.ctx.diffKey, 'easy');
    // 其他難度各自累積，不共用快取
    const other = await callHandler('hard');
    assert.equal(other.headers['x-cache'], 'MISS');
    assert.equal(g.calls(), QUESTION_CACHE_SETS + 1);
  } finally {
    restore();
    console.log = origLog;
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('handler：Gemini 失敗的結果不會進快取', async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const origErr = console.error;
  const origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  const restore = stubFetch(async () => ({ ok: false, status: 503, statusText: 'x', json: async () => ({}) }));
  try {
    for (let i = 0; i < QUESTION_CACHE_SETS + 1; i++) {
      assert.equal((await callHandler('medium')).statusCode, 502);
    }
  } finally {
    restore();
    console.error = origErr;
    console.log = origLog;
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('handler：快取命中仍受限流保護（限流在快取之前）', async () => {
  const prev = { key: process.env.GEMINI_API_KEY, max: process.env.RATE_LIMIT_MAX };
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.RATE_LIMIT_MAX = '1';
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const restore = stubFetch(countingGemini().impl);
  try {
    // 先用不同 IP 把快取累積滿，確保第二個請求「本來可以命中快取」
    for (let i = 0; i < QUESTION_CACHE_SETS; i++) await callHandler('easy');
    const ip = freshIp();
    const first = makeRes();
    await handler(makeReq({ ip }), first);
    const second = makeRes();
    await handler(makeReq({ ip }), second);
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['x-cache'], 'HIT');
    assert.equal(second.statusCode, 429);
  } finally {
    restore();
    console.log = origLog;
    console.warn = origWarn;
    for (const [k, env] of [['key', 'GEMINI_API_KEY'], ['max', 'RATE_LIMIT_MAX']]) {
      if (prev[k] !== undefined) process.env[env] = prev[k];
      else delete process.env[env];
    }
  }
});
