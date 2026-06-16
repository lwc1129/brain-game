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
  shareMsg,
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

const NOW = new Date();
const TODAY = formatDateKey(NOW);

// QB：實際使用的題庫，預設為內建 fallback，questions.json 載入成功後覆蓋。
let QB = QB_FALLBACK;
let _data = null;
let _hist = null;
let _loadingMsgTimer = null;

// 從 GitHub Pages 取得 questions.json。任何失敗（HTTP / network / 驗證不過）
// 皆靜默 fallback 至內建題庫，確保遊戲必定可啟動。
async function fetchQuestionBank() {
  try {
    const r = await fetch('./questions.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!isValidQuestionBank(data)) {
      console.warn('題目數不足或結構不符，使用內建題庫');
      return;
    }
    QB = data;
  } catch (e) {
    console.warn('questions.json 載入失敗，使用內建題庫：', e.message || e);
  }
}

function pickFromBank(diffKey) {
  const recent = loadRecentQuestionTexts(diffKey);
  const qs = pickQuestions(QB[diffKey], QUESTIONS_PER_DAY, recent);
  recordRecentQuestions(diffKey, qs);
  return qs;
}

// ── 字體大小切換 ─────────────────────────────────────────────────────────
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

// ── 畫面 ─────────────────────────────────────────────────────────────────
function mainArea() {
  return document.getElementById('mainArea');
}

function syncAiGeneratedFlag() {
  if (!_data?.questions || _data.steps == null || _data.aiGenerated) return;
  if (isAiGeneratedForDiff(TODAY, getDiff(_data.steps).key)) _data.aiGenerated = true;
}

function qSourceTagClass() {
  return _data.aiGenerated ? 'q-tag q-tag-ai' : 'q-tag q-tag-bank';
}

function qSourceLabel() {
  return _data.aiGenerated ? '🤖 AI 出題' : '📚 題庫出題';
}

function sourceBannerHtml() {
  if (_data.aiGenerated) {
    return `<div class="source-banner source-banner-ai"><div class="source-banner-title">✨ 今日由 AI 出題</div><div class="source-banner-sub">由 Gemini 即時生成，每天都不一樣</div></div>`;
  }
  return `<div class="source-banner source-banner-bank"><div class="source-banner-title">📚 今日由題庫出題</div><div class="source-banner-sub">每週自動更新，近期出過的題目不重複</div></div>`;
}

function clearLoadingMsgTimer() {
  if (_loadingMsgTimer) {
    clearInterval(_loadingMsgTimer);
    _loadingMsgTimer = null;
  }
}

function renderLoading(diffLabel) {
  clearLoadingMsgTimer();
  const msgs = ['🤖 AI 正在出題…', '💭 思考中，請稍候…', '✨ 快好了…'];
  let i = 0;
  mainArea().innerHTML = `<div class="card loading-card" role="status" aria-live="polite">
    <div class="loading-spinner" aria-hidden="true"></div>
    <div class="loading-title">準備今日挑戰</div>
    <div class="loading-sub" id="loadingMsg">${msgs[0]}</div>
    <div class="loading-hint">難度：${diffLabel}</div>
  </div>`;
  _loadingMsgTimer = setInterval(() => {
    i = (i + 1) % msgs.length;
    const el = document.getElementById('loadingMsg');
    if (el) el.textContent = msgs[i];
  }, 1500);
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

function statRowHtml() {
  return `
    <div class="stat-row">
      <div class="stat-box"><div class="sb-n">${_hist.total}</div><div class="sb-l">累積分數</div></div>
      <div class="stat-box"><div class="sb-n">🔥${_hist.streak}</div><div class="sb-l">連續達標天</div></div>
      <div class="stat-box"><div class="sb-n">${_hist.log.length}</div><div class="sb-l">累積天數</div></div>
    </div>`;
}

function historyRowsHtml() {
  return _hist.log
    .slice(-5)
    .reverse()
    .map(
      (d) => `
        <div class="history-row">
          <span class="hr-date">${d.date.replace(/-/g, '/')}</span>
          <span class="hr-info">👟${Number(d.steps).toLocaleString()}步　✓${d.correct}/3</span>
          <span class="hr-score">+${d.score}</span>
        </div>`
    )
    .join('');
}

function renderStep() {
  const histH = _hist.log.length ? statRowHtml() : '';
  const logH = _hist.log.length
    ? `
    <section class="history-card" aria-label="最近記錄">
      <h2 class="stitle">📅 最近記錄</h2>
      ${historyRowsHtml()}
    </section>`
    : '';
  mainArea().innerHTML = `${histH}
    <section class="card" aria-labelledby="stepTitle">
      <h2 class="stitle" id="stepTitle">👟 今天走了幾步？</h2>
      <div class="step-row">
        <label for="si" class="visually-hidden">今日步數</label>
        <input type="number" id="si" placeholder="例：4500" min="0" max="99999" inputmode="numeric" aria-describedby="db">
        <span class="step-unit" aria-hidden="true">步</span>
      </div>
      <div id="db" class="diff-badge" style="display:none;" aria-live="polite"></div>
      <button class="btn-main" id="startBtn">開始今日挑戰</button>
    </section>
    ${logH}
    <div class="fnote">&lt;2000步 困難｜2000-4000 中等｜4000-6000 簡單｜&gt;6000 超簡單<br>每答對一題 +10 分，全對額外 +5 分<br>步數達3000以上計入連續達標天數</div>`;

  let prefetchTimer = null;
  document.getElementById('si').addEventListener('input', function () {
    const v = parseInt(this.value, 10);
    const db = document.getElementById('db');
    if (!isNaN(v) && v >= 0) {
      const d = getDiff(v);
      db.innerHTML = `難度：<strong>${d.label}</strong>　${d.msg}`;
      db.style.display = 'flex';
      if (aiEnabled()) {
        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => prefetchAiQuestions(TODAY, d.key), 400);
      }
    } else db.style.display = 'none';
  });
  document.getElementById('startBtn').addEventListener('click', async () => {
    if (_data.completed) {
      render();
      return;
    }
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
      renderLoading(diff.label);
      const aiQs = await fetchAiQuestions(TODAY, diff.key);
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
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderQ() {
  const diff = getDiff(_data.steps);
  const qH = _data.questions
    .map((q, i) => {
      const ans = _data.answers[i];
      const answered = ans !== undefined;
      const ok = answered && ans === q.a;
      const safeQ = escapeHtml(q.q);
      const safeA = escapeHtml(q.a);
      const opts = q.opts
        .map((o) => {
          const safeO = escapeHtml(o);
          let c = 'q-opt';
          if (answered) {
            if (o === q.a) c += ' correct';
            else if (o === ans) c += ' wrong';
          }
          return `<button class="${c}" data-i="${i}" data-o="${safeO}" ${answered ? 'disabled' : ''}>${safeO}</button>`;
        })
        .join('');
      const res = answered
        ? `<div class="q-result show ${ok ? 'ok' : 'fail'}" role="status">${ok ? '✓ 答對了！+10分' : '✗ 正確答案是「' + safeA + '」'}</div>`
        : '';
      return `<section class="question-card ${answered ? 'done' : ''}" aria-labelledby="qt${i}">
      <div class="q-header"><div class="q-num" id="qn${i}">第 ${i + 1} 題 / 3</div><div class="${qSourceTagClass()}">${qSourceLabel()}｜${diff.label}</div></div>
      <div class="q-text" id="qt${i}">${safeQ}</div>
      <div class="q-options" role="group" aria-labelledby="qn${i}">${opts}</div>${res}</section>`;
    })
    .join('');
  const allDone =
    _data.answers.length === QUESTIONS_PER_DAY &&
    _data.questions.every((_, i) => _data.answers[i] !== undefined);
  mainArea().innerHTML = `
    <div class="card steps-summary">
      <div class="steps-summary-row">
        <span class="steps-summary-label">今日步數</span>
        <span class="steps-summary-value">${Number(_data.steps).toLocaleString()} 步</span>
      </div>
      <div class="steps-summary-diff">${diff.label}</div>
    </div>
    ${sourceBannerHtml()}
    ${qH}
    ${allDone ? `<button class="btn-main" id="finishBtn" style="background:var(--accent);">完成！查看今日成果</button>` : ''}`;
  document.querySelectorAll('.q-opt:not([disabled])').forEach((b) => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.i, 10);
      if (_data.answers[i] !== undefined) return;
      _data.answers[i] = b.dataset.o;
      saveTodayData(TODAY, _data);
      trackEvent('answer_question', {
        question_index: i,
        is_correct: b.dataset.o === _data.questions[i].a ? 1 : 0,
        difficulty_level: getDiff(_data.steps).key,
      });
      render();
    });
  });
  const fb = document.getElementById('finishBtn');
  if (fb)
    fb.addEventListener('click', () => {
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
    });
}

function renderComplete() {
  const c = countCorrect(_data.answers, _data.questions);
  const sc = computeScore(c);
  const diff = getDiff(_data.steps);
  const emoji = c === 3 ? '🏆' : c === 2 ? '🎯' : c === 1 ? '💡' : '🌱';
  const dots = _data.questions
    .map((_, i) => (_data.answers[i] === _data.questions[i].a ? '🟢' : '🔴'))
    .join(' ');
  const txt = `📅 ${TODAY.replace(/-/g, '/')}\n👟 今日步數：${Number(_data.steps).toLocaleString()} 步\n🧠 答題成績：${c}/3 題\n${dots}\n${shareMsg(c)}\n每日認知挑戰 ✨`;
  const logH = _hist.log.length
    ? historyRowsHtml()
    : '<div class="history-empty">尚無記錄</div>';
  mainArea().innerHTML = `
    <div class="share-card" role="status">
      <div class="se" aria-hidden="true">${emoji}</div>
      <div class="sd">${TODAY.replace(/-/g, '/')}　每日認知挑戰</div>
      <div class="st">今日完成！</div>
      <div class="share-stats">
        <div class="ss"><div class="ss-n">${Number(_data.steps).toLocaleString()}</div><div class="ss-l">今日步數</div></div>
        <div class="ss"><div class="ss-n">${c} / 3</div><div class="ss-l">答對題數</div></div>
        <div class="ss"><div class="ss-n">+${sc}</div><div class="ss-l">今日得分</div></div>
      </div>
      <div class="sdiff">${diff.label}　·　${qSourceLabel()}</div>
      <div class="smsg">${shareMsg(c)}</div>
      <div class="sstreak">🔥 連續達標 ${_hist.streak} 天｜累積 ${_hist.total} 分</div>
      <div class="sdots" aria-hidden="true">${dots}</div>
    </div>
    ${sourceBannerHtml()}
    <div class="action-row">
      <button class="btn-share" id="copyBtn">📋 複製分享文字</button>
      <button class="btn-retry" id="retryBtn">重新挑戰</button>
    </div>
    <button id="backBtn" class="btn-back">← 返回主頁</button>
    ${statRowHtml()}
    <section class="history-card" aria-label="最近記錄">
      <h2 class="stitle">📅 最近記錄</h2>${logH}
    </section>
    <div class="sponsor-card">
      <p class="sponsor-msg">喜歡每日認知挑戰？用一杯咖啡支持我們繼續做下去 ☕</p>
      <a href="https://portaly.cc/start/newMode" target="_blank" rel="noopener noreferrer" class="btn-sponsor">支持我們</a>
    </div>
    <div class="fnote">完成後截圖或點複製，把今日成果傳給家人 😊</div>`;
  document.getElementById('copyBtn').addEventListener('click', () => {
    trackEvent('share_result', { score: sc, correct_count: c });
    if (typeof navigator.clipboard?.writeText === 'function') {
      const b = document.getElementById('copyBtn');
      navigator.clipboard
        .writeText(txt)
        .then(() => {
          b.textContent = '✅ 已複製！';
          setTimeout(() => {
            b.textContent = '📋 複製分享文字';
          }, 2000);
        })
        .catch(() => prompt('長按複製：', txt));
    } else {
      prompt('長按複製：', txt);
    }
  });
  document.getElementById('backBtn').addEventListener('click', () => {
    _data.completed = false;
    renderStep();
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    if (!confirm('重新挑戰？今日得分將扣除。')) return;
    trackEvent('retry_game', { previous_score: sc });
    _hist = revertDailyResult(_hist, { today: TODAY, score: sc });
    bumpAiRetryVersion(TODAY);
    clearInflight();
    _data = { steps: null, questions: null, answers: [], completed: false, aiGenerated: false };
    saveTodayData(TODAY, _data);
    saveHistory(_hist);
    render();
  });
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

// 先載入動態題庫（成功則覆蓋 QB，失敗則沿用內建題庫），完成後再啟動主流程。
fetchQuestionBank().then(init);
