// brain-game AI 出題 proxy（Vercel Serverless Function）。
//
// 前端只送 { difficulty }，Gemini API key 以環境變數保管，
// 永遠不會出現在瀏覽器端。
//
// Vercel 專案 Settings → Environment Variables：
//  - GEMINI_API_KEY（必填）：Google AI Studio API key
//  - ALLOWED_ORIGINS（選填）：允許的前端來源，逗號分隔；預設為 GitHub Pages 網址

const DIFFICULTIES = new Set(['hard', 'medium', 'easy', 'super_easy']);
const QUESTIONS_PER_DAY = 3;
const MODEL_NAME = 'gemini-2.5-flash';
const DEFAULT_ALLOWED_ORIGINS = 'https://lwc1129.github.io';

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
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'proxy not configured' });

  const questions = await callGemini(difficulty, process.env.GEMINI_API_KEY);
  if (!questions) return res.status(502).json({ error: 'generation failed' });
  return res.status(200).json({ questions });
}
