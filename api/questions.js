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
import { isValidQuestions, QUESTION_TYPES, LIVE_QUESTION_TYPES } from '../js/logic.js';

export { isValidQuestions, QUESTION_TYPES, LIVE_QUESTION_TYPES };

const DIFFICULTIES = new Set(['hard', 'medium', 'easy', 'super_easy']);
const QUESTIONS_PER_DAY = 3;
const MODEL_NAME = 'gemini-3.5-flash-lite';
// 輸出 token 上限。gemini-3.5-flash-lite 預設會先「思考」，思考 token 也計入此上限，
// 512 時常把 3 題中文 JSON 截斷成解析失敗；因此把思考降到最低（thinkingLevel: 'MINIMAL'，
// 該模型本身的預設值）並放寬上限。Gemini 3 系列已棄用 thinkingBudget，帶上會回
// 400 INVALID_ARGUMENT，故改用 thinkingLevel。
export const GEMINI_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_ALLOWED_ORIGINS = 'https://lwc1129.github.io';

// 預設限流：每個來源 60 秒內最多 30 次。可由環境變數覆寫。
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
// 限流表的鍵數量上限，超過時觸發清掃，避免記憶體無限成長。
const MAX_TRACKED_KEYS = 10_000;
// Gemini 呼叫逾時。必須小於前端 FETCH_TIMEOUT_MS（js/ai.js，8000ms），
// 讓 proxy 先放棄並回 502 + 結構化 log，而不是前端先 abort、後端無聲掛著。
export const GEMINI_TIMEOUT_MS = 7_000;

// 記憶體型滑動視窗限流狀態（來源 → 命中時間戳陣列）。
//
// 注意：Vercel serverless 為多實例且會冷啟動，此限流為「盡力而為」的單實例
// 防護——能擋下單一來源在熱實例上的洗版，避免任意人打爆 Gemini 配額；但無法
// 跨實例共享狀態。若需嚴格的全域限流，應改接 Vercel KV / Upstash Redis。
const _hits = new Map();

// ── 題目快取（單實例、記憶體）──────────────────────────────────────────────
// 同一天（台灣時間）、同難度先累積 QUESTION_CACHE_SETS 組 Gemini 題目，之後的請求
// 從中隨機挑一組回傳，不再呼叫 Gemini：回應更快、Gemini 配額與被濫用的成本下降。
// 取捨：同一天可能有人拿到相同題組（重新挑戰也可能重複）；快取只存在熱實例，
// 冷啟動會重新累積。若需跨實例共享，改接 Vercel KV / Upstash Redis。
// 快取放在 origin、enum、rate limit 檢查之後，四項防線不受影響。
export const QUESTION_CACHE_SETS = 5;
const _questionCache = new Map();

// 台灣日期鍵（YYYY-MM-DD），與前端以使用者當地日期換日的時機一致。
export function taipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}

// 純函式：題組已累積滿 maxSets 時隨機回傳其中一組，否則回傳 null（需要呼叫 Gemini）。
export function pickCachedSet(store, key, maxSets, rand = Math.random) {
  const sets = store.get(key);
  if (!sets || sets.length < maxSets) return null;
  return sets[Math.floor(rand() * sets.length)];
}

// 純函式：加入一組題目，並移除非 today 的舊鍵，確保記憶體只保留當天資料。
export function addCachedSet(store, key, today, questions, maxSets) {
  for (const k of store.keys()) if (!k.startsWith(`${today}:`)) store.delete(k);
  const sets = store.get(key) || [];
  if (sets.length < maxSets) sets.push(questions);
  store.set(key, sets);
}

// 測試用：重設模組層級的題目快取，避免測試之間互相影響。
export function resetQuestionCache() {
  _questionCache.clear();
}

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

// 難度描述對齊 generate_questions.py 的認知負荷契約（Issue #37 rubric / #46 校準）：
// 難度來自步驟數、推理鏈與記憶負荷，而不是冷僻題材或專業術語。
const DIFF_DESC = {
  hard: '困難（需要三步以上思考，例如多步混合運算、非等差數列或條件推理；用字淺白、題材貼近日常生活，不要冷僻知識或專業術語）',
  medium: '中等（需要兩步左右的思考，例如兩位數乘個位數、先算出間距的數列、簡單日期推算）',
  easy: '簡單（一到兩步即可作答，例如兩位數加減、明顯的等差數列、分類找不同）',
  super_easy: '超簡單（一看就能作答，例如個位數加法、生活常識，不要有複雜運算）',
};

// 題型白名單 QUESTION_TYPES 定義於 js/logic.js（與 generate_questions.py 的 ALLOWED_TYPES 對齊），
// 任何進入 prompt 的題型字串都必須出自這份清單。
// 即時出題只用其中的 LIVE_QUESTION_TYPES（不含「記憶」，原因見 js/logic.js）。

// 隨機挑 3 種不同題型，讓每日 AI 題目不會固定落在同一類。
// rand 參數可注入固定值以利測試。
export function pickPromptTypes(rand = Math.random) {
  const pool = [...LIVE_QUESTION_TYPES];
  const picked = [];
  while (picked.length < QUESTIONS_PER_DAY && pool.length) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return picked;
}

export function buildPrompt(diffKey, types = []) {
  // 插值前先以白名單過濾：不合法的題型字串一律不得進入 prompt。
  const safeTypes = types.filter((t) => LIVE_QUESTION_TYPES.includes(t));
  const typeLine =
    safeTypes.length === QUESTIONS_PER_DAY
      ? `請出${QUESTIONS_PER_DAY}題，題型分別為：${safeTypes.join('、')}。\n\n`
      : `請出${QUESTIONS_PER_DAY}題，題型只能從以下選擇：${LIVE_QUESTION_TYPES.join('、')}。\n\n`;
  return (
    `你是一位認知訓練出題專家，請為台灣的銀髮族長輩出${DIFF_DESC[diffKey]}的繁體中文腦力訓練題目。\n\n` +
    typeLine +
    // 以下兩行對應 isValidQuestions 的即時出題規則；只改 prompt 不改驗證（或反過來）會讓退回題庫的比例上升。
    '每一題都必須只看題文就能作答，不可以引用題文以外的內容（例如「剛才的清單」）。\n' +
    '計算題的題文只能是一行算式，並以「= ？」結尾，例如「8 × 11 − 5 × 4 = ？」，不要出應用題。\n\n' +
    '每題格式為JSON物件：\n' +
    '{"type":"題型","q":"題目文字","a":"正確答案","opts":["選項1","選項2","選項3","選項4"]}\n' +
    '正確答案必須包含在opts陣列中，選項順序隨機。\n\n' +
    '只回傳JSON陣列，不要其他文字或markdown：\n[{...},{...},{...}]'
  );
}

// 結構化輸出 schema：要求模型直接產生符合 isValidQuestions 結構的 JSON，
// 降低格式錯誤率。只使用 Gemini 文件長期支援的欄位（type/enum/minItems/maxItems/required/
// propertyOrdering）；長度上限等其餘限制交給 isValidQuestions 驗證，schema 只是第一道防線。
export const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  minItems: QUESTIONS_PER_DAY,
  maxItems: QUESTIONS_PER_DAY,
  items: {
    type: 'OBJECT',
    properties: {
      type: { type: 'STRING', enum: LIVE_QUESTION_TYPES },
      q: { type: 'STRING' },
      a: { type: 'STRING' },
      opts: { type: 'ARRAY', minItems: 4, maxItems: 4, items: { type: 'STRING' } },
    },
    required: ['type', 'q', 'a', 'opts'],
    propertyOrdering: ['type', 'q', 'a', 'opts'],
  },
};

// 結構化 JSON log（格式見 CLAUDE.md 第 2 節）。
function logJson(level, msg, ctx) {
  const log = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  log(JSON.stringify({ level, ts: new Date().toISOString(), msg, ctx }));
}

// 呼叫 Gemini，回傳模型輸出的原始文字；非 2xx 時記錄 log 並回傳 null。
// 逾時、網路錯誤、body 非 JSON 會丟例外，由 handler 統一記錄並回 502。
async function requestGemini(diffKey, types, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(diffKey, types) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
      }),
    }
  );
  if (!res.ok) {
    logJson('error', 'Gemini 回應非 2xx', { status: res.status, statusText: res.statusText, diffKey });
    return null;
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// 純函式：把模型輸出文字解析成陣列。先整段 JSON.parse，失敗再擷取第一個 [...] 區段
// （模型偶爾包 markdown）。無法解析回傳 undefined（JSON 本身可能就是 null，不能拿 null 當失敗）；
// 結構是否合法交給 isValidQuestions。
export function parseQuestionsText(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]);
    } catch {
      return undefined;
    }
  }
}

async function callGemini(diffKey, apiKey) {
  // 指定題型是 best-effort：模型偏離指定題型時不拒絕，
  // 回應仍一律由 isValidQuestions 把關。
  const types = pickPromptTypes();
  logJson('info', 'Gemini call 嘗試', { diffKey, types });
  const raw = await requestGemini(diffKey, types, apiKey);
  if (raw === null) return null;
  const qs = parseQuestionsText(raw);
  if (qs === undefined) {
    logJson('error', 'Gemini 回應 JSON 解析失敗', { diffKey, rawLength: raw.length });
    return null;
  }
  if (!isValidQuestions(qs)) {
    logJson('error', 'isValidQuestions 驗證失敗', { diffKey, count: Array.isArray(qs) ? qs.length : 0 });
    return null;
  }
  const questions = qs.slice(0, QUESTIONS_PER_DAY);
  logJson('info', 'Gemini 出題成功', { diffKey, count: questions.length });
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

  const today = taipeiDateKey();
  const cacheKey = `${today}:${difficulty}`;
  const cached = pickCachedSet(_questionCache, cacheKey, QUESTION_CACHE_SETS);
  if (cached) {
    console.log(
      JSON.stringify({
        level: 'info',
        ts: new Date().toISOString(),
        msg: '題目快取命中',
        ctx: { diffKey: difficulty, cacheKey, sets: _questionCache.get(cacheKey).length },
      })
    );
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ questions: cached });
  }

  // fetch 逾時（TimeoutError）、網路錯誤、回應 body 非 JSON 都會丟例外；
  // 一律記錄結構化 log 並回 502，避免未處理例外變成無 log 的 500。
  let questions;
  try {
    questions = await callGemini(difficulty, process.env.GEMINI_API_KEY);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        ts: new Date().toISOString(),
        msg: 'Gemini 呼叫例外',
        ctx: {
          diffKey: difficulty,
          errorName: e?.name ?? 'Error',
          error: e?.message ?? String(e),
          timeoutMs: GEMINI_TIMEOUT_MS,
        },
      })
    );
    return res.status(502).json({ error: 'generation failed' });
  }
  if (!questions) return res.status(502).json({ error: 'generation failed' });
  addCachedSet(_questionCache, cacheKey, today, questions, QUESTION_CACHE_SETS);
  res.setHeader('X-Cache', 'MISS');
  return res.status(200).json({ questions });
}
