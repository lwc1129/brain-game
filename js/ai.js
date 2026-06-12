// AI 出題：透過後端 serverless API（見 api/questions.js）取得 Gemini 生成的題目。
// 前端只送出難度，金鑰由 proxy 端保管，絕不出現在瀏覽器。
import { CONFIG } from './config.js';
import { isValidQuestions, QUESTIONS_PER_DAY } from './logic.js';
import { readAiCache, writeAiCache } from './storage.js';

const FETCH_TIMEOUT_MS = 8000;
const _inflight = {};

export function aiEnabled() {
  return Boolean(CONFIG.AI_PROXY_URL);
}

export function clearInflight() {
  Object.keys(_inflight).forEach((k) => delete _inflight[k]);
}

async function fetchFromProxy(today, diffKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ difficulty: diffKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const qs = data?.questions;
    if (!isValidQuestions(qs)) return null;
    const out = qs.slice(0, QUESTIONS_PER_DAY);
    writeAiCache(today, diffKey, out);
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAiQuestions(today, diffKey) {
  if (!aiEnabled()) return null;
  const cached = readAiCache(today, diffKey);
  if (cached) return cached;
  if (_inflight[diffKey]) return _inflight[diffKey];
  _inflight[diffKey] = fetchFromProxy(today, diffKey).finally(() => {
    delete _inflight[diffKey];
  });
  return _inflight[diffKey];
}

export function prefetchAiQuestions(today, diffKey) {
  if (!aiEnabled() || readAiCache(today, diffKey)) return;
  fetchAiQuestions(today, diffKey);
}
