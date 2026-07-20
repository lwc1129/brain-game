export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function statRowHtml(hist) {
  return `
    <div class="stat-row">
      <div class="stat-box"><div class="sb-n">${hist.total}</div><div class="sb-l">累積分數</div></div>
      <div class="stat-box"><div class="sb-n">🔥${hist.streak}</div><div class="sb-l">連續達標天</div></div>
      <div class="stat-box"><div class="sb-n">${hist.log.length}</div><div class="sb-l">累積天數</div></div>
    </div>`;
}

export function historyRowsHtml(hist) {
  return hist.log
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

export function qSourceTagClass(aiGenerated) {
  return aiGenerated ? 'q-tag q-tag-ai' : 'q-tag q-tag-bank';
}

export function qSourceLabel(aiGenerated) {
  return aiGenerated ? '🤖 AI 出題' : '📚 題庫出題';
}

export function sourceBannerHtml(aiGenerated) {
  if (aiGenerated) {
    return `<div class="source-banner source-banner-ai"><div class="source-banner-title">✨ 今日由 AI 出題</div><div class="source-banner-sub">由 Gemini 即時生成，每天都不一樣</div></div>`;
  }
  return `<div class="source-banner source-banner-bank"><div class="source-banner-title">📚 今日由題庫出題</div><div class="source-banner-sub">每週自動更新，近期出過的題目不重複</div></div>`;
}
