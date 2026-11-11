import { statRowHtml, historyRowsHtml, qSourceLabel, sourceBannerHtml } from './helpers.js';
import { QUESTIONS_PER_DAY, shareMsg } from '../logic.js';
import { logError } from '../logger.js';

export const COPY_FEEDBACK_MS = 2000;

// 分享文字附上的網址，與 index.html 的 canonical 一致；家人收到後可直接點開來玩。
export const SHARE_URL = 'https://lwc1129.github.io/brain-game/';

// 支援 Web Share API（多數手機）時直接叫出分享選單（可選 LINE），否則改為複製文字。
export function shareButtonLabel(canShare) {
  return canShare ? '📤 分享給家人' : '📋 複製分享文字';
}

function canNativeShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

function shareCardHtml(today, data, c, sc, diff, hist, dots) {
  const emoji = c === 3 ? '🏆' : c === 2 ? '🎯' : c === 1 ? '💡' : '🌱';
  return `
    <div class="share-card" role="status">
      <div class="se" aria-hidden="true">${emoji}</div>
      <div class="sd">${today.replace(/-/g, '/')}　每日認知挑戰</div>
      <div class="st">今日完成！</div>
      <div class="share-stats">
        <div class="ss"><div class="ss-n">${Number(data.steps).toLocaleString()}</div><div class="ss-l">今日步數</div></div>
        <div class="ss"><div class="ss-n">${c} / ${QUESTIONS_PER_DAY}</div><div class="ss-l">答對題數</div></div>
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
      <button class="btn-share" id="copyBtn">${shareButtonLabel(canNativeShare())}</button>
      <button class="btn-retry" id="retryBtn" aria-controls="retryConfirm" aria-expanded="false">重新挑戰</button>
    </div>
    <div class="confirm-panel" id="retryConfirm" role="group" aria-labelledby="retryConfirmMsg" hidden>
      <div class="confirm-msg" id="retryConfirmMsg">確定要重新挑戰嗎？<br>今日得分 +${sc} 將會扣除。</div>
      <div class="confirm-actions">
        <button type="button" class="btn-confirm-yes" id="retryYes">確定重新挑戰</button>
        <button type="button" class="btn-confirm-no" id="retryNo">取消</button>
      </div>
    </div>
    <div class="copy-fallback" id="copyFallback" hidden>
      <div class="copy-fallback-hint" id="copyFallbackHint">請長按下方文字，選「全選」再「複製」：</div>
      <textarea id="copyFallbackText" readonly aria-labelledby="copyFallbackHint"></textarea>
    </div>
    <button id="backBtn" class="btn-back">← 返回主頁</button>
    ${statRowHtml(hist)}
    <section class="history-card" aria-label="最近記錄"><h2 class="stitle">📅 最近記錄</h2>${logH}</section>
    <div class="sponsor-card">
      <p class="sponsor-msg">喜歡每日認知挑戰？用一杯咖啡支持我們繼續做下去 ☕</p>
      <a href="https://portaly.cc/linus/support" target="_blank" rel="noopener noreferrer" class="btn-sponsor">支持我們</a>
    </div>
    <div class="fnote">截圖或按上方的分享按鈕，把今日成果傳給家人 😊</div>`;
}

export function buildShareText(today, data, c, dots) {
  return `📅 ${today.replace(/-/g, '/')}\n👟 今日步數：${Number(data.steps).toLocaleString()} 步\n🧠 答題成績：${c}/${QUESTIONS_PER_DAY} 題\n${dots}\n${shareMsg(c)}\n每日認知挑戰 ✨ 一起來動動腦：\n${SHARE_URL}`;
}

// 剪貼簿不可用或被拒時，在頁面上顯示可長按複製的文字框（取代原生 prompt）。
function showCopyFallback(txt) {
  const box = document.getElementById('copyFallback');
  const ta = document.getElementById('copyFallbackText');
  ta.value = txt;
  box.hidden = false;
  ta.focus();
  ta.select();
}

function copyShareText(txt) {
  const b = document.getElementById('copyBtn');
  if (typeof navigator.clipboard?.writeText !== 'function') {
    showCopyFallback(txt);
    return;
  }
  navigator.clipboard
    .writeText(txt)
    .then(() => {
      b.textContent = '✅ 已複製！';
      setTimeout(() => {
        b.textContent = shareButtonLabel(canNativeShare());
      }, COPY_FEEDBACK_MS);
    })
    .catch((e) => {
      logError('copyShareText', e);
      showCopyFallback(txt);
    });
}

function shareResult(txt) {
  if (!canNativeShare()) {
    copyShareText(txt);
    return;
  }
  navigator.share({ text: txt }).catch((e) => {
    // 使用者自己關掉分享選單（AbortError）不算錯誤；其他失敗改走複製。
    if (e?.name === 'AbortError') return;
    logError('shareResult', e);
    copyShareText(txt);
  });
}

function bindRetryConfirm(onRetry) {
  const retryBtn = document.getElementById('retryBtn');
  const panel = document.getElementById('retryConfirm');
  const close = () => {
    panel.hidden = true;
    retryBtn.setAttribute('aria-expanded', 'false');
    retryBtn.focus();
  };
  retryBtn.addEventListener('click', () => {
    panel.hidden = false;
    retryBtn.setAttribute('aria-expanded', 'true');
    document.getElementById('retryYes').focus();
  });
  document.getElementById('retryNo').addEventListener('click', close);
  // 頁內（非 modal）確認面板：不鎖焦點，但支援 Escape 取消。
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.getElementById('retryYes').addEventListener('click', onRetry);
}

export function bindCompleteEvents(txt, sc, c, onBack, onRetry, onShare) {
  document.getElementById('copyBtn').addEventListener('click', () => {
    onShare(sc, c);
    shareResult(txt);
  });
  document.getElementById('backBtn').addEventListener('click', onBack);
  bindRetryConfirm(onRetry);
}
