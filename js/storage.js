// localStorage 存取層：所有 key 沿用既有命名空間，升級不影響舊使用者資料。
import { APP_NAMESPACE } from './config.js';

function read(key) {
  try {
    return localStorage.getItem(`${APP_NAMESPACE}:${key}`);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${APP_NAMESPACE}:${key}`, value);
  } catch {}
}

function readJson(key) {
  try {
    const r = read(key);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

export function loadTodayData(today) {
  const def = { steps: null, questions: null, answers: [], completed: false, aiGenerated: false };
  const saved = readJson(`today:${today}`);
  return saved ? { ...def, ...saved } : def;
}

export function saveTodayData(today, data) {
  write(`today:${today}`, JSON.stringify(data));
}

export function loadHistory() {
  return readJson('history') || { total: 0, streak: 0, lastDate: null, log: [] };
}

export function saveHistory(hist) {
  write('history', JSON.stringify(hist));
}

// ── 近期出題記錄：避免熟客連日遇到重複題目 ──────────────────────────────
// 每個難度各自保留最近 21 題（約一週份量），抽題時優先排除。
const RECENT_LIMIT = 21;

export function loadRecentQuestionTexts(diffKey) {
  const list = readJson(`recent:${diffKey}`);
  return new Set(Array.isArray(list) ? list : []);
}

export function recordRecentQuestions(diffKey, questions) {
  const set = loadRecentQuestionTexts(diffKey);
  for (const q of questions) {
    set.delete(q.q);
    set.add(q.q);
  }
  write(`recent:${diffKey}`, JSON.stringify([...set].slice(-RECENT_LIMIT)));
}

// ── 字體大小偏好 ─────────────────────────────────────────────────────────
export function loadFontScale() {
  const v = parseFloat(read('font-scale'));
  return Number.isFinite(v) && v >= 1 && v <= 2 ? v : 1;
}

export function saveFontScale(scale) {
  write('font-scale', String(scale));
}

// ── AI 出題快取 ──────────────────────────────────────────────────────────
export function getAiRetryVersion(today) {
  const v = parseInt(read(`ai-retry:${today}`), 10);
  return Number.isFinite(v) ? v : 0;
}

export function bumpAiRetryVersion(today) {
  write(`ai-retry:${today}`, String(getAiRetryVersion(today) + 1));
}

function aiCacheKey(today, diffKey) {
  return `ai-cache:${today}:${diffKey}:v${getAiRetryVersion(today)}`;
}

export function readAiCache(today, diffKey) {
  const p = readJson(aiCacheKey(today, diffKey));
  return Array.isArray(p) && p.length === 3 ? p : null;
}

export function writeAiCache(today, diffKey, questions) {
  write(aiCacheKey(today, diffKey), JSON.stringify(questions));
  write(`ai-flag:${aiCacheKey(today, diffKey)}`, '1');
}

export function isAiGeneratedForDiff(today, diffKey) {
  return read(`ai-flag:${aiCacheKey(today, diffKey)}`) === '1';
}
