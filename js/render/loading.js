export const LOADING_MSG_INTERVAL_MS = 1500;

const LOADING_MSGS = ['🤖 AI 正在出題…', '💭 思考中，請稍候…', '✨ 快好了…'];

export function renderLoading(mainArea, diffLabel, clearTimer) {
  if (typeof clearTimer === 'function') clearTimer();
  let i = 0;
  mainArea.innerHTML = `<div class="card loading-card" role="status" aria-live="polite">
    <div class="loading-spinner" aria-hidden="true"></div>
    <div class="loading-title">準備今日挑戰</div>
    <div class="loading-sub" id="loadingMsg">${LOADING_MSGS[0]}</div>
    <div class="loading-hint">難度：${diffLabel}</div>
  </div>`;
  return setInterval(() => {
    i = (i + 1) % LOADING_MSGS.length;
    const el = document.getElementById('loadingMsg');
    if (el) el.textContent = LOADING_MSGS[i];
  }, LOADING_MSG_INTERVAL_MS);
}
