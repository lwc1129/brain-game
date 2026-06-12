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
  hard: '困難（需要思考的挑戰性題目，考驗邏輯與計算能力）',
  medium: '中等（需要一點思考，適合一般成人）',
  easy: '簡單（輕鬆的題目，適合日常練習）',
  super_easy: '超簡單（適合老年人的非常簡單題目，不要有複雜運算）',
};

export function buildPrompt(diffKey) {
  return (
    `你是一位認知訓練出題專家，請為台灣的銀髮族長輩出${DIFF_DESC[diffKey]}的繁體中文腦力訓練題目。\n\n` +
    `請出${QUESTIONS_PER_DAY}題，題型只能從以下選擇：邏輯、計算、數列、推理、語言、記憶、常識。\n\n` +
    '每題格式為JSON物件：\n' +
    '{"type":"題型","q":"題目文字","a":"正確答案","opts":["選項1","選項2","選項3","選項4"]}\n' +
    '正確答案必須包含在opts陣列中，選項順序隨機。\n\n' +
    '只回傳JSON陣列，不要其他文字或markdown：\n[{...},{...},{...}]'
  );
}

export function isValidQuestions(qs) {
  return (
    Array.isArray(qs) &&
    qs.length >= QUESTIONS_PER_DAY &&
    qs.every(
      (q) =>
        q &&
        typeof q.type === 'string' &&
        typeof q.q === 'string' &&
        typeof q.a === 'string' &&
        Array.isArray(q.opts) &&
        q.opts.length === 4 &&
        q.opts.every((o) => typeof o === 'string') &&
        q.opts.includes(q.a)
    )
  );
}

async function callGemini(diffKey, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(diffKey) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let qs;
  try {
    qs = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      qs = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  return isValidQuestions(qs) ? qs.slice(0, QUESTIONS_PER_DAY) : null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'proxy not configured' });

  const questions = await callGemini(difficulty, process.env.GEMINI_API_KEY);
  if (!questions) return res.status(502).json({ error: 'generation failed' });
  return res.status(200).json({ questions });
}
