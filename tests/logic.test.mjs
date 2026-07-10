// 前端純邏輯（js/logic.js）單元測試。
// 執行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDailyResult,
  computeScore,
  countCorrect,
  formatDateKey,
  getDiff,
  isValidQuestionBank,
  isValidQuestions,
  MAX_HISTORY_LOG,
  pickQuestions,
  revertDailyResult,
  shareMsg,
  shuffleOptions,
  yesterdayKey,
} from '../js/logic.js';

function makeQuestion(text = '1 + 1 = ？') {
  return { type: '計算', q: text, a: '2', opts: ['2', '3', '1', '4'] };
}

function makeBank(n = 3) {
  const bank = {};
  for (const d of ['hard', 'medium', 'easy', 'super_easy']) {
    bank[d] = Array.from({ length: n }, (_, i) => makeQuestion(`${d} 題目 ${i}？`));
  }
  return bank;
}

// ── 難度判定 ─────────────────────────────────────────────────────────────
test('getDiff 邊界值', () => {
  assert.equal(getDiff(0).key, 'hard');
  assert.equal(getDiff(1999).key, 'hard');
  assert.equal(getDiff(2000).key, 'medium');
  assert.equal(getDiff(4000).key, 'medium');
  assert.equal(getDiff(4001).key, 'easy');
  assert.equal(getDiff(6000).key, 'easy');
  assert.equal(getDiff(6001).key, 'super_easy');
});

// ── 抽題 ─────────────────────────────────────────────────────────────────
test('pickQuestions 抽出指定題數且不重複', () => {
  const pool = Array.from({ length: 10 }, (_, i) => makeQuestion(`題 ${i}？`));
  const picked = pickQuestions(pool, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((q) => q.q)).size, 3);
});

test('pickQuestions 優先排除近期出過的題目', () => {
  const pool = Array.from({ length: 10 }, (_, i) => makeQuestion(`題 ${i}？`));
  const recent = new Set(pool.slice(0, 7).map((q) => q.q));
  for (let i = 0; i < 20; i++) {
    const picked = pickQuestions(pool, 3, recent);
    assert.equal(picked.length, 3);
    for (const q of picked) assert.ok(!recent.has(q.q), `${q.q} 不應在近期清單中`);
  }
});

test('pickQuestions 新題不足時回頭使用近期題目，保證抽得滿', () => {
  const pool = Array.from({ length: 5 }, (_, i) => makeQuestion(`題 ${i}？`));
  const recent = new Set(pool.slice(0, 4).map((q) => q.q));
  const picked = pickQuestions(pool, 3, recent);
  assert.equal(picked.length, 3);
  assert.ok(picked.some((q) => !recent.has(q.q)), '唯一的新題必須被抽中');
});

test('pickQuestions 題池小於需求時全數回傳', () => {
  const pool = [makeQuestion('唯一一題？')];
  assert.equal(pickQuestions(pool, 3).length, 1);
});

function makeTypedQuestion(type, text) {
  return { ...makeQuestion(text), type };
}

test('pickQuestions 題型多樣性：題型足夠時單場三題皆不同題型', () => {
  const pool = [];
  for (const type of ['計算', '邏輯', '記憶', '常識']) {
    for (let i = 0; i < 5; i++) pool.push(makeTypedQuestion(type, `${type} 題 ${i}？`));
  }
  for (let i = 0; i < 20; i++) {
    const picked = pickQuestions(pool, 3);
    assert.equal(new Set(picked.map((q) => q.type)).size, 3, '三題應為三種不同題型');
  }
});

test('pickQuestions 題型多樣性：題池只有單一題型時仍抽滿', () => {
  const pool = Array.from({ length: 10 }, (_, i) => makeQuestion(`題 ${i}？`));
  const picked = pickQuestions(pool, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((q) => q.q)).size, 3, '題目不可重複');
});

test('pickQuestions 題型多樣性：兩種題型時涵蓋兩種', () => {
  const pool = [];
  for (const type of ['計算', '邏輯']) {
    for (let i = 0; i < 5; i++) pool.push(makeTypedQuestion(type, `${type} 題 ${i}？`));
  }
  for (let i = 0; i < 20; i++) {
    const picked = pickQuestions(pool, 3);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked.map((q) => q.type)).size, 2, '兩種題型都應出現');
  }
});

test('pickQuestions 新舊優先序高於題型多樣性：同題型新題優先於異題型舊題', () => {
  const pool = [
    ...Array.from({ length: 3 }, (_, i) => makeTypedQuestion('計算', `新計算題 ${i}？`)),
    ...['邏輯', '記憶', '常識'].map((t) => makeTypedQuestion(t, `舊${t}題？`)),
  ];
  const recent = new Set(pool.slice(3).map((q) => q.q));
  for (let i = 0; i < 20; i++) {
    const picked = pickQuestions(pool, 3, recent);
    for (const q of picked) assert.ok(!recent.has(q.q), '必須先抽完新題才能動用近期出過的題');
  }
});

test('shuffleOptions 打亂選項順序：正確答案不會永遠在第一個', () => {
  const qs = Array.from({ length: 30 }, (_, i) => makeQuestion(`題 ${i}？`));
  const out = shuffleOptions(qs);
  for (const [i, q] of out.entries()) {
    assert.deepEqual([...q.opts].sort(), [...qs[i].opts].sort(), '選項集合不變');
    assert.ok(q.opts.includes(q.a), '正確答案仍在選項中');
  }
  assert.ok(
    out.some((q) => q.opts[0] !== q.a),
    '30 題中至少一題的第一個選項不是正確答案'
  );
  // 不修改原資料
  assert.equal(qs[0].opts[0], qs[0].a);
});

// ── 計分 ─────────────────────────────────────────────────────────────────
test('computeScore：每題 10 分，全對加 5 分', () => {
  assert.equal(computeScore(0), 0);
  assert.equal(computeScore(1), 10);
  assert.equal(computeScore(2), 20);
  assert.equal(computeScore(3), 35);
});

test('countCorrect 比對答案', () => {
  const qs = [makeQuestion('a？'), makeQuestion('b？'), makeQuestion('c？')];
  assert.equal(countCorrect(['2', '3', '2'], qs), 2);
  assert.equal(countCorrect([], qs), 0);
});

test('shareMsg 對應各種成績', () => {
  for (const c of [0, 1, 2, 3]) assert.equal(typeof shareMsg(c), 'string');
  assert.notEqual(shareMsg(3), shareMsg(0));
});

// ── 歷史統計 ─────────────────────────────────────────────────────────────
test('applyDailyResult：達標步數延續連勝', () => {
  const hist = { total: 100, streak: 2, lastDate: '2026-06-09', log: [] };
  const next = applyDailyResult(hist, {
    today: '2026-06-10',
    yesterday: '2026-06-09',
    steps: 5000,
    correct: 3,
    score: 35,
  });
  assert.equal(next.streak, 3);
  assert.equal(next.lastDate, '2026-06-10');
  assert.equal(next.total, 135);
  assert.equal(next.log.length, 1);
  // 原物件不被修改
  assert.equal(hist.streak, 2);
  assert.equal(hist.log.length, 0);
});

test('applyDailyResult：中斷後連勝重設為 1', () => {
  const hist = { total: 0, streak: 5, lastDate: '2026-06-01', log: [] };
  const next = applyDailyResult(hist, {
    today: '2026-06-10',
    yesterday: '2026-06-09',
    steps: 3000,
    correct: 1,
    score: 10,
  });
  assert.equal(next.streak, 1);
});

test('applyDailyResult：步數未達標不影響連勝', () => {
  const hist = { total: 0, streak: 5, lastDate: '2026-06-09', log: [] };
  const next = applyDailyResult(hist, {
    today: '2026-06-10',
    yesterday: '2026-06-09',
    steps: 2999,
    correct: 1,
    score: 10,
  });
  assert.equal(next.streak, 5);
  assert.equal(next.lastDate, '2026-06-09');
});

test('applyDailyResult：記錄超過上限時裁掉最舊', () => {
  const log = Array.from({ length: MAX_HISTORY_LOG }, (_, i) => ({
    date: `d${i}`,
    steps: 0,
    correct: 0,
    score: 0,
  }));
  const next = applyDailyResult(
    { total: 0, streak: 0, lastDate: null, log },
    { today: '2026-06-10', yesterday: '2026-06-09', steps: 0, correct: 0, score: 0 }
  );
  assert.equal(next.log.length, MAX_HISTORY_LOG);
  assert.equal(next.log.at(-1).date, '2026-06-10');
});

test('revertDailyResult 撤銷當日分數與記錄', () => {
  const hist = {
    total: 135,
    streak: 3,
    lastDate: '2026-06-10',
    log: [
      { date: '2026-06-09', steps: 4000, correct: 2, score: 20 },
      { date: '2026-06-10', steps: 5000, correct: 3, score: 35 },
    ],
  };
  const next = revertDailyResult(hist, { today: '2026-06-10', score: 35 });
  assert.equal(next.total, 100);
  assert.equal(next.log.length, 1);
  assert.equal(next.log[0].date, '2026-06-09');
  // streak/lastDate 必須回滾，不能保留撤銷前的虛高連勝
  assert.equal(next.streak, 1);
  assert.equal(next.lastDate, '2026-06-09');
});

// ── 題庫驗證 ─────────────────────────────────────────────────────────────
test('isValidQuestionBank：合法題庫通過', () => {
  assert.ok(isValidQuestionBank(makeBank()));
});

test('isValidQuestionBank：缺難度、題數不足、答案不在選項中皆失敗', () => {
  const missing = makeBank();
  delete missing.hard;
  assert.equal(isValidQuestionBank(missing), false);

  const short = makeBank();
  short.easy = short.easy.slice(0, 2);
  assert.equal(isValidQuestionBank(short), false);

  const badAnswer = makeBank();
  badAnswer.hard[0] = { ...badAnswer.hard[0], a: '不存在的答案' };
  assert.equal(isValidQuestionBank(badAnswer), false);

  assert.equal(isValidQuestionBank(null), false);
  assert.equal(isValidQuestionBank([]), false);
});

test('isValidQuestions：AI 回傳題組驗證', () => {
  assert.ok(isValidQuestions([makeQuestion(), makeQuestion(), makeQuestion()]));
  assert.equal(isValidQuestions([makeQuestion(), makeQuestion()]), false);
  assert.equal(isValidQuestions('not-an-array'), false);
  const bad = makeQuestion();
  bad.opts = ['2', '3'];
  assert.equal(isValidQuestions([makeQuestion(), makeQuestion(), bad]), false);
});

test('isValidQuestions / isValidQuestionBank：選項重複時不通過', () => {
  const dup = makeQuestion();
  dup.opts = ['2', '2', '3', '4'];
  assert.equal(isValidQuestions([makeQuestion(), makeQuestion(), dup]), false);

  const bank = makeBank();
  bank.easy[0] = { ...bank.easy[0], opts: ['2', '2', '3', '4'] };
  assert.equal(isValidQuestionBank(bank), false);
});

// ── 日期 ─────────────────────────────────────────────────────────────────
test('formatDateKey / yesterdayKey', () => {
  const d = new Date(2026, 5, 10); // 2026-06-10
  assert.equal(formatDateKey(d), '2026-06-10');
  assert.equal(yesterdayKey(d), '2026-06-09');
});

test('內建題庫本身通過驗證', async () => {
  const { QB_FALLBACK } = await import('../js/fallback-questions.js');
  assert.ok(isValidQuestionBank(QB_FALLBACK));
});
