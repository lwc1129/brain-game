import { statRowHtml, historyRowsHtml, qSourceLabel, sourceBannerHtml } from './helpers.js';
import { shareMsg } from '../logic.js';

export const COPY_FEEDBACK_MS = 2000;

function shareCardHtml(today, data, c, sc, diff, hist, dots) {
  const emoji = c === 3 ? '🏆' : c === 2 ? '🎯' : c === 1 ? '💡' : '🌱';
  return `
    <div class="share-card" role="status">
      <div class="se" aria-hidden="true">${emoji}</div>
      <div class="sd">${today.replace(/-/g, '/')}　每日認知挑戰</div>
      <div class="st">今日完成！</div>
      <div class="share-stats">
        <div class="ss"><div class="ss-n">${Number(data.steps).toLocaleString()}</div><div class="ss-l">今日步數</div></div>
        <div class="ss"><div class="ss-n">${c} / 3</div><div class="ss-l">答對題數</div></div>
        <div class="ss"><div class="ss-n">+${sc}</div><div class="ss-l">今日得分</div></div>
      </div>
      <div class="sdiff">${diff.label}　·　${qSourceLabel(data.aiGenerated)}</div>
      <div class="smsg">${shareMsg(c)}</div>
      <div class="sstreak">🔥 連續達標 ${hist.streak} 天｜累積 ${hist.total} 分</div>
      <div class="sdots" aria-hidden="true">${dots}</div>
    </div>`;
}

export function buildCompleteHtml(today, data, c, sc, diff, hist, dots) {
  const logH = hist.log.length ? historyRowsHtml(hist) : '<div class="history-empty">尚無記錄</div>';
  return `${shareCardHtml(today, data, c, sc, diff, hist, dots)}
    ${sourceBannerHtml(data.aiGenerated)}
    <div class="action-row">
      <button class="btn-share" id="copyBtn">📋 複製分享文字</button>
      <button class="btn-retry" id="retryBtn">重新挑戰</button>
    </div>
    <button id="backBtn" class="btn-back">← 返回主頁</button>
    ${statRowHtml(hist)}
    <section class="history-card" aria-label="最近記錄"><h2 class="stitle">📅 最近記錄</h2>${logH}</section>
    <div class="sponsor-card">
      <p class="sponsor-msg">喜歡每日認知挑戰？用一杯咖啡支持我們繼續做下去 ☕</p>
      <a href="https://portaly.cc/linus/support" target="_blank" rel="noopener noreferrer" class="btn-sponsor">支持我們</a>
    </div>
    <div class="fnote">完成後截圖或點複製，把今日成果傳給家人 😊</div>`;
}

export function buildShareText(today, data, c, dots) {
  return `📅 ${today.replace(/-/g, '/')}\n👟 今日步數：${Number(data.steps).toLocaleString()} 步\n🧠 答題成績：${c}/3 題\n${dots}\n${shareMsg(c)}\n每日認知挑戰 ✨`;
}

export function bindCompleteEvents(txt, sc, c, onBack, onRetry, onShare) {
  document.getElementById('copyBtn').addEventListener('click', () => {
    onShare(sc, c);
    if (typeof navigator.clipboard?.writeText === 'function') {
      const b = document.getElementById('copyBtn');
      navigator.clipboard
        .writeText(txt)
        .then(() => {
          b.textContent = '✅ 已複製！';
          setTimeout(() => {
            b.textContent = '📋 複製分享文字';
          }, COPY_FEEDBACK_MS);
        })
        .catch(() => prompt('長按複製：', txt));
    } else {
      prompt('長按複製：', txt);
    }
  });
  document.getElementById('backBtn').addEventListener('click', onBack);
  document.getElementById('retryBtn').addEventListener('click', onRetry);
}
