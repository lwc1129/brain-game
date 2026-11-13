export const LOADING_MSG_INTERVAL_MS = 1500;

const LOADING_MSGS = ['🤖 AI 正在出題…', '💭 思考中，請稍候…', '✨ 快好了…'];

// 等超過這個時間就不再輪播「快好了」，改成誠實說明比較慢、等不到會改用題庫，
// 免得長者看同樣三句繞好幾圈，以為畫面當掉。前端最多等 FETCH_TIMEOUT_MS（js/ai.js）。
export const SLOW_HINT_AFTER_MS = 6000;
export const SLOW_HINT_MSG = '⏳ 今天出題比較慢，請再等一下；等不到會改用題庫';

// 純函式：載入畫面經過 elapsedMs 時要顯示的文字。
export function loadingMessageAt(elapsedMs) {
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  if (ms >= SLOW_HINT_AFTER_MS) return SLOW_HINT_MSG;
  return LOADING_MSGS[Math.floor(ms / LOADING_MSG_INTERVAL_MS) % LOADING_MSGS.length];
}

export function renderLoading(mainArea, diffLabel, clearTimer) {
  if (typeof clearTimer === 'function') clearTimer();
  const startedAt = Date.now();
  mainArea.innerHTML = `<div class="card loading-card" role="status" aria-live="polite">
    <div class="loading-spinner" aria-hidden="true"></div>
    <div class="loading-title">準備今日挑戰</div>
    <div class="loading-sub" id="loadingMsg">${loadingMessageAt(0)}</div>
    <div class="loading-hint">難度：${diffLabel}</div>
  </div>`;
  return setInterval(() => {
    const el = document.getElementById('loadingMsg');
    if (!el) return;
    const msg = loadingMessageAt(Date.now() - startedAt);
    // 文字沒變就不重寫，避免 aria-live 重複朗讀同一句。
    if (el.textContent !== msg) el.textContent = msg;
  }, LOADING_MSG_INTERVAL_MS);
}
