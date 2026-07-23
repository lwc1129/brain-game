import { statRowHtml, historyRowsHtml } from './helpers.js';

export const PREFETCH_DEBOUNCE_MS = 400;

function stepSectionHtml() {
  return `
    <section class="card" aria-labelledby="stepTitle">
      <h2 class="stitle" id="stepTitle">👟 今天走了幾步？</h2>
      <div class="step-row">
        <label for="si" class="visually-hidden">今日步數</label>
        <input type="number" id="si" placeholder="例：4500" min="0" max="99999" inputmode="numeric" aria-describedby="db">
        <span class="step-unit" aria-hidden="true">步</span>
      </div>
      <div id="db" class="diff-badge" style="display:none;" aria-live="polite"></div>
      <button class="btn-main" id="startBtn">開始今日挑戰</button>
    </section>`;
}

function footnoteHtml() {
  return `<div class="fnote">&lt;2000步 困難｜2000-4000 中等｜4000-6000 簡單｜&gt;6000 超簡單<br>每答對一題 +10 分，全對額外 +5 分<br>步數達3000以上計入連續達標天數</div>`;
}

export function buildStepHtml(hist) {
  const histH = hist.log.length ? statRowHtml(hist) : '';
  const logH = hist.log.length
    ? `<section class="history-card" aria-label="最近記錄"><h2 class="stitle">📅 最近記錄</h2>${historyRowsHtml(hist)}</section>`
    : '';
  return `${histH}${stepSectionHtml()}${logH}${footnoteHtml()}`;
}

export function bindStepInput(prefetch, getDiff, aiEnabled) {
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
        prefetchTimer = setTimeout(() => prefetch(d.key), PREFETCH_DEBOUNCE_MS);
      }
    } else db.style.display = 'none';
  });
}

export function bindStartButton(onStart, onRerender) {
  document.getElementById('startBtn').addEventListener('click', async () => {
    if (onRerender()) return;
    await onStart();
  });
}
