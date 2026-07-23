import { escapeHtml, qSourceTagClass, qSourceLabel, sourceBannerHtml } from './helpers.js';
import { QUESTIONS_PER_DAY } from '../logic.js';

function questionCardHtml(q, i, diff, answered, ans) {
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
  const tag = qSourceTagClass(diff.aiGenerated);
  const label = qSourceLabel(diff.aiGenerated);
  return `<section class="question-card ${answered ? 'done' : ''}" aria-labelledby="qt${i}">
    <div class="q-header"><div class="q-num" id="qn${i}">第 ${i + 1} 題 / 3</div><div class="${tag}">${label}｜${diff.label}</div></div>
    <div class="q-text" id="qt${i}">${safeQ}</div>
    <div class="q-options" role="group" aria-labelledby="qn${i}">${opts}</div>${res}</section>`;
}

export function buildQuestionHtml(data, diff) {
  const qH = data.questions
    .map((q, i) => {
      const ans = data.answers[i];
      return questionCardHtml(q, i, { ...diff, aiGenerated: data.aiGenerated }, ans !== undefined, ans);
    })
    .join('');
  const allDone =
    data.answers.length === QUESTIONS_PER_DAY &&
    data.questions.every((_, i) => data.answers[i] !== undefined);
  const finishBtn = allDone
    ? `<button class="btn-main" id="finishBtn" style="background:var(--accent);">完成！查看今日成果</button>`
    : '';
  return `
    <div class="card steps-summary">
      <div class="steps-summary-row">
        <span class="steps-summary-label">今日步數</span>
        <span class="steps-summary-value">${Number(data.steps).toLocaleString()} 步</span>
      </div>
      <div class="steps-summary-diff">${diff.label}</div>
    </div>
    ${sourceBannerHtml(data.aiGenerated)}
    ${qH}
    ${finishBtn}`;
}

export function bindQuestionEvents(data, onAnswer, onFinish) {
  document.querySelectorAll('.q-opt:not([disabled])').forEach((b) => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.i, 10);
      if (data.answers[i] !== undefined) return;
      onAnswer(i, b.dataset.o);
    });
  });
  const fb = document.getElementById('finishBtn');
  if (fb) fb.addEventListener('click', onFinish);
}
