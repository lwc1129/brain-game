// 純函式遊戲邏輯：不碰 DOM、不碰 localStorage、不發網路請求，
// 可直接在 Node 的測試環境執行（見 tests/logic.test.mjs）。

export const DIFFICULTIES = ['hard', 'medium', 'easy', 'super_easy'];

// 每次挑戰的題數，與每個難度的最低題目數對齊。
export const QUESTIONS_PER_DAY = 3;
export const MIN_PER_DIFFICULTY = 3;

// 計入「連續達標」的每日步數門檻。
export const STREAK_STEP_GOAL = 3000;

// 歷史記錄保留筆數上限。
export const MAX_HISTORY_LOG = 30;

export function formatDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function yesterdayKey(d) {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return formatDateKey(prev);
}

export function formatFullDate(d) {
  const w = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日　星期${w[d.getDay()]}`;
}

export function getDiff(steps) {
  if (steps < 2000) return { key: 'hard', label: '困難 💪', msg: '走得少，來動動腦補一補！' };
  if (steps <= 4000) return { key: 'medium', label: '中等 😊', msg: '繼續加油，身體和腦子都要動！' };
  if (steps <= 6000) return { key: 'easy', label: '簡單 👍', msg: '走得不錯！獎勵輕鬆題目～' };
  return { key: 'super_easy', label: '超簡單 🎉', msg: '太厲害了！今天大步走！' };
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 題庫與 AI 回傳的 opts 常把正確答案放在第一個，必須打亂選項順序，
// 否則「永遠選第一個」就能全對。
export function shuffleOptions(questions) {
  return questions.map((q) => ({ ...q, opts: shuffled(q.opts) }));
}

// 從題池抽題，優先抽「近期沒出過」的題目（recentTexts 為近期題目文字集合），
// 不夠時才回頭使用近期出過的題，保證一定抽得滿。選項順序一律打亂。
export function pickQuestions(pool, count, recentTexts = new Set()) {
  const fresh = [];
  const seen = [];
  for (const q of pool) (recentTexts.has(q.q) ? seen : fresh).push(q);
  const out = [];
  for (const group of [fresh, seen]) {
    const p = [...group];
    while (out.length < count && p.length) {
      out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
    }
  }
  return shuffleOptions(out);
}

export function countCorrect(answers, questions) {
  return answers.filter((a, i) => a === questions[i].a).length;
}

export function computeScore(correct) {
  return correct * 10 + (correct === QUESTIONS_PER_DAY ? 5 : 0);
}

export function shareMsg(c) {
  if (c === 3) return '全對！腦力滿滿 💪';
  if (c === 2) return '答對兩題，明天繼續！';
  if (c === 1) return '答對一題，多走幾步挑簡單的！';
  return '今天先熱身，明天再接再厲 😄';
}

// 完成當日挑戰後更新歷史統計（回傳新物件，不修改傳入的 hist）。
export function applyDailyResult(hist, { today, yesterday, steps, correct, score }) {
  const next = { ...hist, log: [...hist.log] };
  if (steps >= STREAK_STEP_GOAL) {
    if (next.lastDate === yesterday) next.streak += 1;
    else if (next.lastDate !== today) next.streak = 1;
    next.lastDate = today;
  }
  next.total += score;
  next.log.push({ date: today, steps, correct, score });
  if (next.log.length > MAX_HISTORY_LOG) next.log = next.log.slice(-MAX_HISTORY_LOG);
  return next;
}

// 重新挑戰時撤銷當日結果（回傳新物件）。
// 同時從剩餘 log 重算 streak/lastDate，避免撤銷後保留虛高的連勝紀錄。
export function revertDailyResult(hist, { today, score }) {
  const log = hist.log.filter((d) => d.date !== today);
  const qualifying = log.filter((e) => e.steps >= STREAK_STEP_GOAL);
  let streak = 0;
  let lastDate = null;
  if (qualifying.length > 0) {
    lastDate = qualifying.at(-1).date;
    streak = 1;
    for (let i = qualifying.length - 1; i > 0; i--) {
      const curr = new Date(qualifying[i].date);
      const expected = new Date(curr);
      expected.setDate(expected.getDate() - 1);
      if (qualifying[i - 1].date === formatDateKey(expected)) streak++;
      else break;
    }
  }
  return { ...hist, total: hist.total - score, log, streak, lastDate };
}

// 驗證動態題庫結構：四個難度皆存在、皆為陣列、且各自題目數 >= 最低需求。
export function isValidQuestionBank(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return DIFFICULTIES.every(
    (d) => Array.isArray(data[d]) && data[d].length >= MIN_PER_DIFFICULTY && data[d].every(isValidQuestion)
  );
}

export function isValidQuestion(q) {
  return (
    !!q &&
    typeof q === 'object' &&
    typeof q.type === 'string' &&
    typeof q.q === 'string' &&
    typeof q.a === 'string' &&
    Array.isArray(q.opts) &&
    q.opts.length === 4 &&
    q.opts.every((o) => typeof o === 'string') &&
    new Set(q.opts).size === 4 &&
    q.opts.includes(q.a)
  );
}

// 驗證 AI proxy 回傳的單日題組。
export function isValidQuestions(qs) {
  return Array.isArray(qs) && qs.length >= QUESTIONS_PER_DAY && qs.every(isValidQuestion);
}
