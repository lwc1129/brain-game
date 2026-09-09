// Proxy 整合測試：模擬完整請求序列（mock fetch，不發真實網路請求）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../../api/questions.js';

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

let _ipSeq = 100;
function freshIp() {
  _ipSeq += 1;
  return `198.51.100.${_ipSeq}`;
}

test('integration proxy-flow: OPTIONS preflight → POST valid → rate limit → disallowed origin', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevMax = process.env.RATE_LIMIT_MAX;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.RATE_LIMIT_MAX = '2';
  const restore = stubFetch(geminiOk(threeQuestions()));
  const ip = freshIp();

  try {
    // OPTIONS preflight
    const optRes = makeRes();
    await handler(makeReq({ method: 'OPTIONS', ip }), optRes);
    assert.equal(optRes.statusCode, 204);
    console.log('PASS [proxy-flow]: OPTIONS preflight → 204');

    // POST valid difficulty
    const okRes = makeRes();
    await handler(makeReq({ ip }), okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body.questions.length, 3);
    console.log('PASS [proxy-flow]: POST valid difficulty → 200');

    // POST rate limit exceeded
    await handler(makeReq({ ip }), makeRes());
    const blocked = makeRes();
    await handler(makeReq({ ip }), blocked);
    assert.equal(blocked.statusCode, 429);
    console.log('PASS [proxy-flow]: POST rate limit exceeded → 429');

    // POST disallowed origin
    const evil = makeRes();
    await handler(
      makeReq({ origin: 'https://evil.example', ip: freshIp() }),
      evil
    );
    assert.equal(evil.statusCode, 403);
    console.log('PASS [proxy-flow]: POST disallowed origin → 403');
  } finally {
    restore();
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
    if (prevMax !== undefined) process.env.RATE_LIMIT_MAX = prevMax;
    else delete process.env.RATE_LIMIT_MAX;
  }
});
