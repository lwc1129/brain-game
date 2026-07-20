// brain-game AI 出題 proxy（Vercel Serverless Function）。
//
// 前端只送 { difficulty }，Gemini API key 以環境變數保管，
// 永遠不會出現在瀏覽器端。
//
// Vercel 專案 Settings → Environment Variables：
//  - GEMINI_API_KEY（必填）：Google AI Studio API key
//  - ALLOWED_ORIGINS（選填）：允許的前端來源，逗號分隔；預設為 GitHub Pages 網址
//  - RATE_LIMIT_MAX（選填）：單一來源於視窗內允許的請求數；預設 30
//  - RATE_LIMIT_WINDOW_MS（選填）：限流視窗長度（毫秒）；預設 60000

// isValidQuestions 與前端 js/logic.js 共用，避免 proxy 與前端驗證邏輯漂移。
// Vercel serverless 可直接 import 同 repo 的 ES module。
import { isValidQuestions } from '../js/logic.js';

export { isValidQuestions };

const DIFFICULTIES = new Set(['hard', 'medium', 'easy', 'super_easy']);
const QUESTIONS_PER_DAY = 3;
const MODEL_NAME = 'gemini-2.5-flash';
const DEFAULT_ALLOWED_ORIGINS = 'https://lwc1129.github.io';

// 預設限流：每個來源 60 秒內最多 30 次。可由環境變數覆寫。
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
// 限流表的鍵數量上限，超過時觸發清掃，避免記憶體無限成長。
const MAX_TRACKED_KEYS = 10_000;

// 記憶體型滑動視窗限流狀態（來源 → 命中時間戳陣列）。
//
// 注意：Vercel serverless 為多實例且會冷啟動，此限流為「盡力而為」的單實例
// 防護——能擋下單一來源在熱實例上的洗版，避免任意人打爆 Gemini 配額；但無法
// 跨實例共享狀態。若需嚴格的全域限流，應改接 Vercel KV / Upstash Redis。
const _hits = new Map();

function rateLimitConfig() {
  const max = Number(process.env.RATE_LIMIT_MAX);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT_MAX,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT_WINDOW_MS,
  };
}

// 取得用戶端識別碼。Vercel 會在 x-forwarded-for 帶入真實 IP（可能含多個，
// 取第一個有效者為原始來源），退而求其次使用連線位址。
// 注意要略過空白 token（例如 header 以逗號開頭），避免多個來源誤共用同一限流桶。
export function getClientKey(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string') {
    for (const part of xff.split(',')) {
      const ip = part.trim();
      if (ip) return ip;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

// 滑動視窗限流純函式：依現存命中時間戳判斷是否放行，並就地更新 store。
export function checkRateLimit(store, key, now, max, windowMs) {
  const cutoff = now - windowMs;
  const hits = (store.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    store.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  store.set(key, hits);
  return { allowed: true, remaining: Math.max(0, max - hits.length), retryAfterMs: 0 };
}

// 將限流表收斂在 maxKeys 之內，保證記憶體有硬上限。
// 正常情況（未超量）直接略過，維持低成本；一旦超量才動作：
//   1) 先移除已過期的來源紀錄
//   2) 若仍超量（例如大量不同來源在同一視窗內湧入，每筆都還沒過期），
//      強制驅逐「最久未活動」的來源直到符合上限。
//      被驅逐者的限流計數會重置，是為了換取記憶體上限的可接受取捨。
export function pruneStore(store, now, windowMs, maxKeys) {
  if (store.size <= maxKeys) return;
  const cutoff = now - windowMs;
  for (const [k, hits] of store) {
    const live = hits.filter((t) => t > cutoff);
    if (live.length === 0) store.delete(k);
    else if (live.length !== hits.length) store.set(k, live);
  }
  if (store.size <= maxKeys) return;
  const byRecency = [...store.entries()].sort(
    (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1]
  );
  for (let i = 0, n = store.size - maxKeys; i < n; i++) store.delete(byRecency[i][0]);
}

const DIFF_DESC = {
  hard: '困難（需要思考的挑戰性技術題目，考驗邏輯與計算能力）',
  medium: '中等（需要一點思考，適合一般成人）',
  easy: '簡單（輕鬆的題目，適合日常練習）',
  super_easy: '超簡單（適合老年人的非常簡單題目，不要有複雜運算）',
};

// 題型白名單。任何進入 prompt 的題型字串都必須出自這份清單
// （與 generate_questions.py 的 ALLOWED_TYPES 對齊）。
export const QUESTION_TYPES = ['邏輯', '計算', '數列', '推理', '語言', '記憶', '常識'];

// 隨機挑 3 種不同題型，讓每日 AI 題目不會固定落在同一類。
// rand 參數可注入固定值以利測試。
export function pickPromptTypes(rand = Math.random) {
  const pool = [...QUESTION_TYPES];
  const picked = [];
  while (picked.length < QUESTIONS_PER_DAY && pool.length) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return picked;
}

export function buildPrompt(diffKey, types = []) {
  // 插值前先以白名單過濾：不合法的題型字串一律不得進入 prompt。
  const safeTypes = types.filter((t) => QUESTION_TYPES.includes(t));
  const typeLine =
    safeTypes.length === QUESTIONS_PER_DAY
      ? `請出${QUESTIONS_PER_DAY}題，題型分別為：${safeTypes.join('、')}。\n\n`
      : `請出${QUESTIONS_PER_DAY}題，題型只能從以下選擇：${QUESTION_TYPES.join('、')}。\n\n`;
  return (
    `你是一位認知訓練出題專家，請為台灣的銀髮族長輩出${DIFF_DESC[diffKey]}的繁體中文腦力訓練題目。\n\n` +
    typeLine +
    '每題格式為JSON物件：\n' +
    '{"type":"題型","q":"題目文字","a":"正確答案","opts":["選項1","選項2","選項3","選項4"]}\n' +
    '正確答案必須包含在opts陣列中，選項順序隨機。\n\n' +
    '只回傳JSON陣列，不要其他文字或markdown：\n[{...},{...},{...}]'
  );
}

async function callGemini(diffKey, apiKey) {
  // 指定題型是 best-effort：模型偏離指定題型時不拒絕，
  // 回應仍一律由 isValidQuestions 把關。
  const types = pickPromptTypes();
  console.log(
    JSON.stringify({
      level: 'info',
      ts: new Date().toISOString(),
      msg: 'Gemini call 嘗試',
      ctx: { diffKey, types },
    })
  );
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(diffKey, types) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  if (!res.ok) {
    console.error(
      JSON.stringify({
        level: 'error',
        ts: new Date().toISOString(),
        msg: 'Gemini 回應非 2xx',
        ctx: { status: res.status, statusText: res.statusText, diffKey },
      })
    );
    return null;
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const logParseError = () =>
    console.error(
      JSON.stringify({
        level: 'error',
        ts: new Date().toISOString(),
        msg: 'Gemini 回應 JSON 解析失敗',
        ctx: { diffKey, rawLength: raw.length },
      })
    );
  let qs;
  try {
    qs = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) {
      logParseError();
      return null;
    }
    try {
      qs = JSON.parse(m[0]);
    } catch {
      logParseError();
      return null;
    }
  }
  if (!isValidQuestions(qs)) {
    console.error(
      JSON.stringify({
        level: 'error',
        ts: new Date().toISOString(),
        msg: 'isValidQuestions 驗證失敗',
        ctx: { diffKey, count: Array.isArray(qs) ? qs.length : 0 },
      })
    );
    return null;
  }
  const questions = qs.slice(0, QUESTIONS_PER_DAY);
  console.log(
    JSON.stringify({
      level: 'info',
      ts: new Date().toISOString(),
      msg: 'Gemini 出題成功',
      ctx: { diffKey, count: questions.length },
    })
  );
  return questions;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 在做任何處理前先驗證 origin，來源不符直接 403 拒絕，
  // 避免任意第三方消耗 Gemini 配額。
  const isAllowedOrigin = origin && allowed.includes(origin);
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (!isAllowedOrigin) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        ts: new Date().toISOString(),
        msg: 'origin not allowed',
        ctx: { origin },
      })
    );
    return res.status(403).json({ error: 'origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const difficulty = req.body?.difficulty;
  if (!DIFFICULTIES.has(difficulty)) return res.status(400).json({ error: 'invalid difficulty' });

  // 限流：在呼叫 Gemini 之前先擋，保護 API 配額不被任意來源洗版。
  const { max, windowMs } = rateLimitConfig();
  const now = Date.now();
  pruneStore(_hits, now, windowMs, MAX_TRACKED_KEYS);
  const rl = checkRateLimit(_hits, getClientKey(req), now, max, windowMs);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    console.warn(
      JSON.stringify({
        level: 'warn',
        ts: new Date().toISOString(),
        msg: 'rate limit exceeded',
        ctx: { clientKey: getClientKey(req), remaining: 0 },
      })
    );
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'proxy not configured' });

  const questions = await callGemini(difficulty, process.env.GEMINI_API_KEY);
  if (!questions) return res.status(502).json({ error: 'generation failed' });
  return res.status(200).json({ questions });
}
