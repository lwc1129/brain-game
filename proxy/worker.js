/**
 * brain-game AI 出題 proxy（Cloudflare Worker）。
 *
 * 前端只送 { difficulty }，Gemini API key 以 Worker secret 保管，
 * 永遠不會出現在瀏覽器端。部署方式見 proxy/README.md。
 *
 * 環境設定：
 *  - GEMINI_API_KEY（secret）：Google AI Studio API key
 *  - ALLOWED_ORIGINS（var）：允許的來源，逗號分隔，
 *    例如 "https://lwc1129.github.io"
 */

const DIFFICULTIES = new Set(['hard', 'medium', 'easy', 'super_easy']);
const QUESTIONS_PER_DAY = 3;
const MODEL_NAME = 'gemini-2.5-flash';

const DIFF_DESC = {
  hard: '困難（需要思考的挑戰性題目，考驗邏輯與計算能力）',
  medium: '中等（需要一點思考，適合一般成人）',
  easy: '簡單（輕鬆的題目，適合日常練習）',
  super_easy: '超簡單（適合老年人的非常簡單題目，不要有複雜運算）',
};

function buildPrompt(diffKey) {
  return (
    `你是一位認知訓練出題專家，請為台灣的銀髮族長輩出${DIFF_DESC[diffKey]}的繁體中文腦力訓練題目。\n\n` +
    `請出${QUESTIONS_PER_DAY}題，題型只能從以下選擇：邏輯、計算、數列、推理、語言、記憶、常識。\n\n` +
    '每題格式為JSON物件：\n' +
    '{"type":"題型","q":"題目文字","a":"正確答案","opts":["選項1","選項2","選項3","選項4"]}\n' +
    '正確答案必須包含在opts陣列中，選項順序隨機。\n\n' +
    '只回傳JSON陣列，不要其他文字或markdown：\n[{...},{...},{...}]'
  );
}

function isValidQuestions(qs) {
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

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
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

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method not allowed' }, 405, headers);
    }

    let difficulty;
    try {
      ({ difficulty } = await request.json());
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400, headers);
    }
    if (!DIFFICULTIES.has(difficulty)) {
      return jsonResponse({ error: 'invalid difficulty' }, 400, headers);
    }
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: 'proxy not configured' }, 503, headers);
    }

    const questions = await callGemini(difficulty, env.GEMINI_API_KEY);
    if (!questions) {
      return jsonResponse({ error: 'generation failed' }, 502, headers);
    }
    return jsonResponse({ questions }, 200, headers);
  },
};
