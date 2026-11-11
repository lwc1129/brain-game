// localStorage 存取層：所有 key 沿用既有命名空間，升級不影響舊使用者資料。
import { APP_NAMESPACE } from './config.js';
import { logError } from './logger.js';

function read(key) {
  try {
    return localStorage.getItem(`${APP_NAMESPACE}:${key}`);
  } catch (e) {
    logError({ op: 'read', key }, e);
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${APP_NAMESPACE}:${key}`, value);
  } catch (e) {
    logError({ op: 'write', key }, e);
  }
}

function readJson(key) {
  try {
    const r = read(key);
    return r ? JSON.parse(r) : null;
  } catch (e) {
    logError({ op: 'readJson', key }, e);
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
// 每個難度各自保留最近 RECENT_LIMIT 題，抽題時優先排除（pickQuestions 的 fresh-first）。
// 240 題 = 每天 3 題 × 80 天：每週題庫只換約 8–10 題（每難度上限 300 題），
// 60 題（20 天）的舊值會讓每天玩的長輩 3 週後就開始遇到重複題。
// 必須小於每難度題庫題數（MAX_PER_DIFFICULTY = 300），否則 fresh 題池會被排空；
// 即使排空，pickQuestions 也會回頭使用近期題，保證抽得滿。儲存成本約 10KB / 難度。
export const RECENT_LIMIT = 240;

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
