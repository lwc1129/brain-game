import { QB_FALLBACK } from './fallback-questions.js';
import {
  applyDailyResult,
  computeScore,
  countCorrect,
  effectiveStreak,
  formatDateKey,
  formatFullDate,
  getDiff,
  isValidQuestionBank,
  MAX_STEPS,
  pickQuestions,
  QUESTIONS_PER_DAY,
  revertDailyResult,
  settleWithin,
  shuffleOptions,
  yesterdayKey,
} from './logic.js';
import {
  bumpAiRetryVersion,
  DAILY_KEY_KEEP_DAYS,
  isAiGeneratedForDiff,
  loadFontScale,
  loadHistory,
  loadRecentQuestionTexts,
  loadTodayData,
  pruneOldDailyKeys,
  recordRecentQuestions,
  saveFontScale,
  saveHistory,
  saveTodayData,
} from './storage.js';
import { aiEnabled, clearInflight, fetchAiQuestions, prefetchAiQuestions } from './ai.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { logError } from './logger.js';
import { buildCompleteHtml, buildShareText, bindCompleteEvents } from './render/complete.js';
import { renderLoading } from './render/loading.js';
import { buildQuestionHtml, bindQuestionEvents } from './render/question.js';
import { buildStepHtml, bindStepInput, bindStartButton, showStepError } from './render/step.js';

// 頁面可能跨午夜一直開著（長輩常不關分頁），日期必須可重新同步，見 syncToday()。
let NOW = new Date();
let TODAY = formatDateKey(NOW);

let QB = QB_FALLBACK;
let _data = null;
let _hist = null;
let _loadingMsgTimer = null;
// 出題請求進行中時不換日，避免 await 回來後把題目寫進新一天的 _data。
let _starting = false;

// 按「開始」時題庫若還在下載，最多等這麼久，逾時就先用內建題庫，不讓長輩卡在畫面上。
const BANK_WAIT_MS = 3000;

// 題庫在背景下載，不擋首次畫面。no-cache：每次向伺服器確認（ETag），
// 沒變就用瀏覽器快取，不必每次重新下載 284KB。
async function fetchQuestionBank() {
  try {
    const r = await fetch('./questions.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!isValidQuestionBank(data)) {
      console.warn('題目數不足或結構不符，使用內建題庫');
      logError('fetchQuestionBank', new Error('invalid question bank'));
      return;
    }
    QB = data;
  } catch (e) {
    console.warn('questions.json 載入失敗，使用內建題庫：', e.message || e);
    logError('fetchQuestionBank', e);
  }
}

let _bankReady = Promise.resolve();

async function waitForBank() {
  const r = await settleWithin(_bankReady, BANK_WAIT_MS);
  if (!r.done) logError('waitForBank', new Error(`questions.json 超過 ${BANK_WAIT_MS}ms 未載入，先用內建題庫`));
}

function pickFromBank(diffKey) {
  const recent = loadRecentQuestionTexts(diffKey);
  const qs = pickQuestions(QB[diffKey], QUESTIONS_PER_DAY, recent);
  recordRecentQuestions(diffKey, qs);
  return qs;
}

const FONT_SCALES = [
  { scale: 1, label: '標準', cls: '' },
  { scale: 1.15, label: '大', cls: 'fc-l' },
  { scale: 1.3, label: '特大', cls: 'fc-xl' },
];

function applyFontScale(scale) {
  document.documentElement.style.fontSize = `${scale * 100}%`;
  document.querySelectorAll('.font-controls button').forEach((b) => {
    b.setAttribute('aria-pressed', String(parseFloat(b.dataset.scale) === scale));
  });
}

function initFontControls() {
  const wrap = document.getElementById('fontControls');
  wrap.innerHTML = FONT_SCALES.map(
    (f) =>
      `<button type="button" class="${f.cls}" data-scale="${f.scale}" aria-pressed="false" aria-label="字體大小：${f.label}">${f.label}</button>`
  ).join('');
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scale]');
    if (!b) return;
    const scale = parseFloat(b.dataset.scale);
    applyFontScale(scale);
    saveFontScale(scale);
  });
  applyFontScale(loadFontScale());
}

function mainArea() {
  return document.getElementById('mainArea');
}

// 顯示用歷史：連勝改用 effectiveStreak，中斷多日後不再顯示過期的連勝數。
function displayHist() {
  return { ..._hist, streak: effectiveStreak(_hist, TODAY, yesterdayKey(NOW)) };
}

// 若日期已跨過午夜，切換到新的一天：重新載入當日進度並清掉前一天的 AI 請求。
// 回傳是否發生換日。前一天的進度已存在 localStorage，不會遺失。
function syncToday() {
  const now = new Date();
  const key = formatDateKey(now);
  if (key === TODAY) return false;
  NOW = now;
  TODAY = key;
  clearInflight();
  document.getElementById('todayDate').textContent = formatFullDate(NOW);
  _data = loadTodayData(TODAY);
  _hist = loadHistory();
  syncAiGeneratedFlag();
  return true;
}

function syncAiGeneratedFlag() {
  if (!_data?.questions || _data.steps == null || _data.aiGenerated) return;
  if (isAiGeneratedForDiff(TODAY, getDiff(_data.steps).key)) _data.aiGenerated = true;
}

function clearLoadingMsgTimer() {
  if (_loadingMsgTimer) {
    clearInterval(_loadingMsgTimer);
    _loadingMsgTimer = null;
  }
}

function render() {
  clearLoadingMsgTimer();
  if (_data.completed) {
    renderComplete();
    return;
  }
  if (_data.steps == null) {
    renderStep();
    return;
  }
  renderQ();
}

function renderStep() {
  mainArea().innerHTML = buildStepHtml(displayHist());
  bindStepInput(
    (diffKey) => prefetchAiQuestions(TODAY, diffKey),
    getDiff,
    aiEnabled
  );
  bindStartButton(handleStartGame, () => {
    if (_data.completed) {
      render();
      return true;
    }
    return false;
  });
}

async function handleStartGame() {
  // 出題中（等 AI 或背景題庫）再按開始一律忽略，避免兩次出題寫進同一份 _data。
  if (_starting) return;
  // 步數頁停留跨過午夜後才按開始：先換日，成績才會記在正確的日期。
  if (syncToday() && _data.completed) {
    render();
    return;
  }
  const v = parseInt(document.getElementById('si').value, 10);
  if (isNaN(v) || v < 0 || v > MAX_STEPS) {
    showStepError();
    return;
  }
  const diff = getDiff(v);
  _starting = true;
  // 等待期間鎖住按鈕與輸入框，讓長輩知道已經按到了，也避免改步數造成難度與題目不一致。
  const btn = document.getElementById('startBtn');
  const input = document.getElementById('si');
  btn.disabled = true;
  input.disabled = true;
  try {
    await startGame(v, diff);
  } finally {
    _starting = false;
    // startGame 成功時已換到題目畫面；只有仍停在步數頁時才需要解鎖。
    if (btn.isConnected) btn.disabled = false;
    if (input.isConnected) input.disabled = false;
  }
}

async function startGame(v, diff) {
  _data.steps = v;
  _data.answers = [];
  _data.aiGenerated = false;
  if (aiEnabled()) {
    clearLoadingMsgTimer();
    _loadingMsgTimer = renderLoading(mainArea(), diff.label, clearLoadingMsgTimer);
    const aiQs = await fetchAiQuestions(TODAY, diff.key);
    clearLoadingMsgTimer();
    if (aiQs) {
      _data.questions = shuffleOptions(aiQs);
      _data.aiGenerated = true;
    } else {
      await waitForBank();
      _data.questions = pickFromBank(diff.key);
    }
  } else {
    await waitForBank();
    _data.questions = pickFromBank(diff.key);
  }
  saveTodayData(TODAY, _data);
  trackEvent('start_game', {
    steps: _data.steps,
    difficulty_level: diff.key,
    source: _data.aiGenerated ? 'ai' : 'static',
  });
  render();
}

function renderQ() {
  const diff = getDiff(_data.steps);
  mainArea().innerHTML = buildQuestionHtml(_data, diff);
  bindQuestionEvents(
    _data,
    (i, answer) => {
      _data.answers[i] = answer;
      saveTodayData(TODAY, _data);
      trackEvent('answer_question', {
        question_index: i,
        is_correct: answer === _data.questions[i].a ? 1 : 0,
        difficulty_level: getDiff(_data.steps).key,
      });
      render();
    },
    () => {
      _data.completed = true;
      const c = countCorrect(_data.answers, _data.questions);
      const sc = computeScore(c);
      trackEvent('complete_game', {
        total_score: sc,
        correct_count: c,
        difficulty_level: getDiff(_data.steps).key,
        source: _data.aiGenerated ? 'ai' : 'static',
        steps: _data.steps,
      });
      _hist = applyDailyResult(_hist, {
        today: TODAY,
        yesterday: yesterdayKey(NOW),
        steps: _data.steps,
        correct: c,
        score: sc,
      });
      saveTodayData(TODAY, _data);
      saveHistory(_hist);
      render();
    }
  );
}

function renderComplete() {
  const c = countCorrect(_data.answers, _data.questions);
  const sc = computeScore(c);
  const diff = getDiff(_data.steps);
  const dots = _data.questions
    .map((_, i) => (_data.answers[i] === _data.questions[i].a ? '🟢' : '🔴'))
    .join(' ');
  const txt = buildShareText(TODAY, _data, c, dots);
  mainArea().innerHTML = buildCompleteHtml(TODAY, _data, c, sc, diff, displayHist(), dots);
  bindCompleteEvents(
    txt,
    sc,
    c,
    () => {
      // 返回主頁：清空當日進度並落地，避免 memory/localStorage 不一致與重整跳回完成頁（#33）。
      // 不撤銷成績——重玩計分由 applyDailyResult 同日冪等保護；正式重挑戰走「重新挑戰」。
      _data = { steps: null, questions: null, answers: [], completed: false, aiGenerated: false };
      saveTodayData(TODAY, _data);
      renderStep();
    },
    () => {
      // 確認步驟由 bindCompleteEvents 的頁內確認面板處理（取代原生 confirm）。
      trackEvent('retry_game', { previous_score: sc });
      _hist = revertDailyResult(_hist, { today: TODAY, score: sc });
      bumpAiRetryVersion(TODAY);
      clearInflight();
      _data = { steps: null, questions: null, answers: [], completed: false, aiGenerated: false };
      saveTodayData(TODAY, _data);
      saveHistory(_hist);
      render();
    },
    (shareSc, shareC) => trackEvent('share_result', { score: shareSc, correct_count: shareC })
  );
}

async function init() {
  initAnalytics();
  initFontControls();
  document.getElementById('todayDate').textContent = formatFullDate(NOW);
  // 清掉 DAILY_KEY_KEEP_DAYS 天以前的每日資料，避免 localStorage 只增不減。
  const cutoff = new Date(NOW);
  cutoff.setDate(cutoff.getDate() - DAILY_KEY_KEEP_DAYS);
  pruneOldDailyKeys(formatDateKey(cutoff));
  _data = loadTodayData(TODAY);
  _hist = loadHistory();
  syncAiGeneratedFlag();
  render();
  // 從背景切回分頁時檢查是否已換日；換日則回到新一天的畫面。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !_starting && syncToday()) render();
  });
}

// 註冊 service worker：可加到主畫面、離線時用快取遊玩（見 sw.js）。
// 註冊失敗不影響遊戲，只記錄 log。
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((e) => logError('registerServiceWorker', e));
}

// 先畫出畫面，題庫在背景下載（見 waitForBank）。
_bankReady = fetchQuestionBank();
init();
registerServiceWorker();
