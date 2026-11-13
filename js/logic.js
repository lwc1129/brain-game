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

// 題型白名單（與 generate_questions.py 的 ALLOWED_TYPES 對齊）。
// api/questions.js 由此 import，prompt 插值與回應驗證共用同一份清單。
export const QUESTION_TYPES = ['邏輯', '計算', '數列', '推理', '語言', '記憶', '常識'];

// 即時 AI 出題可用的題型：不含「記憶」。目前介面是單一畫面的選擇題，
// 無法「先出示內容、遮住、再作答」，即時產生的記憶題容易引用玩家沒看過的內容。
// 題庫（questions.json）裡既有的記憶題不受影響，仍以 QUESTION_TYPES 驗證。
export const LIVE_QUESTION_TYPES = QUESTION_TYPES.filter((t) => t !== '記憶');

// 題目與選項長度上限：擋下模型失控輸出的長篇文字，避免破版。
// 現有題庫最長題目 134 字、最長選項 57 字，上限留有餘裕。
export const MAX_QUESTION_LEN = 200;
export const MAX_OPTION_LEN = 80;

// 步數輸入上限，與 index.html #si 的 max 屬性對齊。
export const MAX_STEPS = 99999;

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
// 同場加映題型多樣性：每一輪先從「本場尚未出過的題型」中隨機挑一型再抽題，
// 題型用完才允許重複。優先序為 fresh-first 高於題型多樣性——跨日重複
// 比單場出現同題型更傷體驗。
export function pickQuestions(pool, count, recentTexts = new Set()) {
  const fresh = [];
  const seen = [];
  for (const q of pool) (recentTexts.has(q.q) ? seen : fresh).push(q);
  const out = [];
  const usedTypes = new Set();
  for (const group of [fresh, seen]) {
    const byType = new Map();
    for (const q of group) {
      if (!byType.has(q.type)) byType.set(q.type, []);
      byType.get(q.type).push(q);
    }
    while (out.length < count && byType.size) {
      let types = [...byType.keys()].filter((t) => !usedTypes.has(t));
      if (types.length === 0) types = [...byType.keys()];
      const type = types[Math.floor(Math.random() * types.length)];
      const candidates = byType.get(type);
      const q = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      if (candidates.length === 0) byType.delete(type);
      usedTypes.add(type);
      out.push(q);
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

// 累積遊玩天數。log 受 MAX_HISTORY_LOG 截斷，不能拿 log.length 當天數；
// 改由 hist.days 計數。舊版資料沒有 days 欄位時以 log.length 為初始值（遷移）。
export function playedDays(hist) {
  return Number.isFinite(hist?.days) ? hist.days : (hist?.log?.length ?? 0);
}

// 顯示用連勝天數：儲存的 streak 只在達標日更新，中斷後仍保留舊值。
// lastDate 不是今天或昨天，代表連勝已斷，顯示 0（下次達標時 applyDailyResult 會重設為 1）。
export function effectiveStreak(hist, today, yesterday) {
  if (!hist) return 0;
  return hist.lastDate === today || hist.lastDate === yesterday ? hist.streak : 0;
}

// 完成當日挑戰後更新歷史統計（回傳新物件，不修改傳入的 hist）。
// 同日冪等：若 log 已有當日記錄，先撤銷舊筆再寫入，避免「返回主頁後重玩」重複計分（#33）。
export function applyDailyResult(hist, { today, yesterday, steps, correct, score }) {
  // revertDailyResult 會移除「所有」當日記錄，因此撤銷金額必須加總同日每一筆分數。
  // 只取第一筆會讓「修復前已被本 bug 污染成同日多筆」的歷史殘留扣不回的灌水分數。
  const hadToday = hist.log.some((e) => e.date === today);
  const priorScore = hist.log.reduce((sum, e) => (e.date === today ? sum + e.score : sum), 0);
  const base = hadToday ? revertDailyResult(hist, { today, score: priorScore }) : hist;
  const next = { ...base, log: [...base.log], days: playedDays(base) + 1 };
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

// 重新挑戰／同日取代時撤銷當日結果（回傳新物件）。
// streak/lastDate：若當日是連勝尖端（lastDate===today），從 stored streak 撤一日；
// 不可從剩餘 log 重算——log 有 MAX_HISTORY_LOG 上限，重算會把 31+ 連勝永久縮水（#33 Codex P1）。
export function revertDailyResult(hist, { today, score }) {
  const log = hist.log.filter((d) => d.date !== today);
  const hadToday = log.length !== hist.log.length;
  const days = hadToday ? Math.max(0, playedDays(hist) - 1) : playedDays(hist);
  let streak = hist.streak;
  let lastDate = hist.lastDate;
  if (lastDate === today) {
    streak = Math.max(0, streak - 1);
    if (streak > 0) {
      const prev = new Date(`${today}T12:00:00`);
      prev.setDate(prev.getDate() - 1);
      lastDate = formatDateKey(prev);
    } else {
      lastDate = null;
    }
  }
  return { ...hist, total: hist.total - score, log, days, streak, lastDate };
}

// 驗證動態題庫結構：四個難度皆存在、皆為陣列、且各自題目數 >= 最低需求。
export function isValidQuestionBank(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return DIFFICULTIES.every(
    (d) => Array.isArray(data[d]) && data[d].length >= MIN_PER_DIFFICULTY && data[d].every(isValidQuestion)
  );
}

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

export function isValidQuestion(q) {
  return (
    !!q &&
    typeof q === 'object' &&
    QUESTION_TYPES.includes(q.type) &&
    isNonEmptyString(q.q, MAX_QUESTION_LEN) &&
    isNonEmptyString(q.a, MAX_OPTION_LEN) &&
    Array.isArray(q.opts) &&
    q.opts.length === 4 &&
    q.opts.every((o) => isNonEmptyString(o, MAX_OPTION_LEN)) &&
    new Set(q.opts).size === 4 &&
    q.opts.includes(q.a)
  );
}

// ── 純算式題驗算 ─────────────────────────────────────────────────────────
// AI 即時出題沒有人工 / eval 把關，算錯的題目對長者傷害最大。
// 題目「只由數字與運算符號組成，並以 = ？ 結尾」時（如「8 × 11 − 5 × 4 = ？」），
// 以自寫的遞迴下降解析器計算（不使用 eval），與答案比對。應用題等其他題目不在此範圍。
const ARITH_QUESTION = /^([\d\s.+\-−＋－×xX*÷/()（）]+)[=＝]\s*[？?]\s*$/;
const OP_ALIASES = { '−': '-', '＋': '+', '－': '-', '×': '*', x: '*', X: '*', '÷': '/', '（': '(', '）': ')' };

function tokenizeArithmetic(expr) {
  const tokens = [];
  const src = expr;
  for (let i = 0; i < src.length; ) {
    if (/\s/.test(src[i])) {
      i += 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push(Number(num[0]));
      i += num[0].length;
      continue;
    }
    const op = OP_ALIASES[src[i]] ?? src[i];
    if (!'+-*/()'.includes(op)) return null;
    tokens.push(op);
    i += 1;
  }
  return tokens;
}

// 解析並計算算式；語法錯誤回傳 null，除以 0 等回傳非有限數。
export function evaluateArithmetic(expr) {
  const tokens = tokenizeArithmetic(expr);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  function factor() {
    const t = tokens[pos++];
    if (typeof t === 'number') return t;
    if (t === '-') return -factor();
    if (t === '(') {
      const v = sum();
      if (tokens[pos++] !== ')') throw new Error('unbalanced');
      return v;
    }
    throw new Error('unexpected token');
  }
  function product() {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = tokens[pos++] === '*' ? v * factor() : v / factor();
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') v = tokens[pos++] === '+' ? v + product() : v - product();
    return v;
  }
  try {
    const v = sum();
    return pos === tokens.length ? v : null;
  } catch {
    return null;
  }
}

// 純算式題回傳答案是否正確（true / false）；非純算式題或算式無法解析回傳 null（不適用）。
// 答案取開頭數字比對，允許附單位（如「68元」）與千分位逗號。
export function checkArithmeticAnswer(q) {
  const m = ARITH_QUESTION.exec(q?.q ?? '');
  if (!m) return null;
  const expected = evaluateArithmetic(m[1]);
  if (expected === null) return null;
  if (!Number.isFinite(expected)) return false;
  const ans = /^-?\d+(\.\d+)?/.exec(String(q.a).replace(/,/g, '').trim());
  if (!ans) return false;
  return Math.abs(Number(ans[0]) - expected) < 1e-9;
}

// ── 題文自足性檢查 ───────────────────────────────────────────────────────
// 題文指涉「先前看過的內容」（剛才的清單、上述文章…），卻沒有在題文內附上該內容，
// 玩家無從作答。題文內自帶內容的題目（有冒號，或「請記住…」）不算。
// 規則需與 generate_questions.py 的 refers_to_unseen_content 一致。
const UNSEEN_REF = /剛才|剛剛|上述|上面的|前面(提到|說)|先前/;
const INLINE_CONTENT = /[：:]|記住|請記/;

export function refersToUnseenContent(q) {
  const text = typeof q?.q === 'string' ? q.q : '';
  return UNSEEN_REF.test(text) && !INLINE_CONTENT.test(text);
}

// 驗證 AI proxy 回傳的單日題組（即時出題，沒有人工把關，規則比題庫嚴格）：
// - 結構合法（isValidQuestion）
// - 題文不可指涉玩家沒看過的內容
// - 「計算」題必須是可驗算的純算式且答案正確；應用題無法驗算，一律不收
// - 其他題型若剛好是純算式，答案也必須算得對
// 不在檢查範圍：非計算題的答案對錯、簡繁體、難度是否合適。
export function isValidQuestions(qs) {
  return (
    Array.isArray(qs) &&
    qs.length >= QUESTIONS_PER_DAY &&
    qs.every((q) => {
      if (!isValidQuestion(q) || refersToUnseenContent(q)) return false;
      const arith = checkArithmeticAnswer(q);
      return q.type === '計算' ? arith === true : arith !== false;
    })
  );
}

// 等待 promise 最多 ms 毫秒：如期完成回傳 { done: true, value }，逾時回傳 { done: false }。
// 用於「題庫在背景下載，按開始時最多等一下」這類不能讓長輩卡住的等待。
// promise 若 reject 視為 { done: true, value: undefined }（呼叫端已自行記錄錯誤）。
export function settleWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  const settled = Promise.resolve(promise).then(
    (value) => ({ done: true, value }),
    () => ({ done: true, value: undefined })
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}
