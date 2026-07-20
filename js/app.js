import { QB_FALLBACK } from './fallback-questions.js';
import {
  applyDailyResult,
  computeScore,
  countCorrect,
  formatDateKey,
  formatFullDate,
  getDiff,
  isValidQuestionBank,
  pickQuestions,
  QUESTIONS_PER_DAY,
  revertDailyResult,
  shuffleOptions,
  yesterdayKey,
} from './logic.js';
import {
  bumpAiRetryVersion,
  isAiGeneratedForDiff,
  loadFontScale,
  loadHistory,
  loadRecentQuestionTexts,
  loadTodayData,
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
import { buildStepHtml, bindStepInput, bindStartButton } from './render/step.js';

const NOW = new Date();
const TODAY = formatDateKey(NOW);

let QB = QB_FALLBACK;
let _data = null;
let _hist = null;
let _loadingMsgTimer = null;

async function fetchQuestionBank() {
  try {
    const r = await fetch('./questions.json', { cache: 'no-store' });
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
  mainArea().innerHTML = buildStepHtml(_hist);
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
  const v = parseInt(document.getElementById('si').value, 10);
  if (isNaN(v) || v < 0) {
    alert('請輸入有效步數');
    return;
  }
  const diff = getDiff(v);
  _data.steps = v;
  _data.answers = [];
  _data.aiGenerated = false;
  if (aiEnabled()) {
    clearLoadingMsgTimer();
    _loadingMsgTimer = renderLoading(mainArea(), diff.label);
    const aiQs = await fetchAiQuestions(TODAY, diff.key);
    clearLoadingMsgTimer();
    if (aiQs) {
      _data.questions = shuffleOptions(aiQs);
      _data.aiGenerated = true;
    } else {
      _data.questions = pickFromBank(diff.key);
    }
  } else {
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
  mainArea().innerHTML = buildCompleteHtml(TODAY, _data, c, sc, diff, _hist, dots);
  bindCompleteEvents(
    txt,
    sc,
    c,
    () => {
      _data.completed = false;
      renderStep();
    },
    () => {
      if (!confirm('重新挑戰？今日得分將扣除。')) return;
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
  _data = loadTodayData(TODAY);
  _hist = loadHistory();
  syncAiGeneratedFlag();
  render();
}

fetchQuestionBank().then(init);
