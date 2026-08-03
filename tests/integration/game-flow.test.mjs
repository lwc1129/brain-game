// 整合測試：以純函式模擬完整遊戲流程（不碰 DOM、不發真實網路請求）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDailyResult,
  formatDateKey,
  MAX_HISTORY_LOG,
  revertDailyResult,
  STREAK_STEP_GOAL,
} from '../../js/logic.js';

function emptyHist() {
  return { total: 0, streak: 0, lastDate: null, log: [] };
}

function dayResult(today, yesterday, steps = STREAK_STEP_GOAL, score = 35) {
  return applyDailyResult(emptyHist(), {
    today,
    yesterday,
    steps,
    correct: 3,
    score,
  });
}

function runProfile(name, fn) {
  try {
    fn();
    console.log(`PASS [${name}]: ${fn.description || '完整流程'}`);
  } catch (e) {
    console.log(`FAIL [${name}]: ${e.message}`);
    throw e;
  }
}

test('integration [new-user]: 空歷史記錄首次遊戲完整流程', () => {
  runProfile('new-user', function newUserFirstGame() {
    const hist = emptyHist();
    const next = applyDailyResult(hist, {
      today: '2026-06-10',
      yesterday: '2026-06-09',
      steps: 5000,
      correct: 3,
      score: 35,
    });
    assert.equal(next.streak, 1);
    assert.equal(next.lastDate, '2026-06-10');
    assert.equal(next.total, 35);
    assert.equal(next.log.length, 1);
  });
});

test('integration [streak-10]: 連續 10 天遊玩 streak = 10', () => {
  runProfile('streak-10', function streak10Days() {
    let hist = emptyHist();
    const base = new Date(2026, 0, 1);
    for (let i = 0; i < 10; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const today = formatDateKey(d);
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 1);
      const yesterday = formatDateKey(prev);
      hist = applyDailyResult(hist, {
        today,
        yesterday,
        steps: STREAK_STEP_GOAL,
        correct: 3,
        score: 35,
      });
    }
    assert.equal(hist.streak, 10);
    assert.equal(hist.log.length, 10);
  });
});

test('integration [broken-streak]: lastDate 為 2 天前 streak 重設為 1', () => {
  runProfile('broken-streak', function brokenStreakReset() {
    const hist = {
      total: 100,
      streak: 5,
      lastDate: '2026-06-08',
      log: [{ date: '2026-06-08', steps: STREAK_STEP_GOAL, correct: 3, score: 35 }],
    };
    const next = applyDailyResult(hist, {
      today: '2026-06-10',
      yesterday: '2026-06-09',
      steps: STREAK_STEP_GOAL,
      correct: 2,
      score: 20,
    });
    assert.equal(next.streak, 1);
    assert.equal(next.lastDate, '2026-06-10');
  });
});

test('integration [retry-flow]: 完成後 revert 再重新 apply', () => {
  runProfile('retry-flow', function retryFlow() {
    let hist = applyDailyResult(emptyHist(), {
      today: '2026-06-10',
      yesterday: '2026-06-09',
      steps: 5000,
      correct: 3,
      score: 35,
    });
    assert.equal(hist.total, 35);
    hist = revertDailyResult(hist, { today: '2026-06-10', score: 35 });
    assert.equal(hist.total, 0);
    assert.equal(hist.log.length, 0);
    hist = applyDailyResult(hist, {
      today: '2026-06-10',
      yesterday: '2026-06-09',
      steps: 4000,
      correct: 2,
      score: 20,
    });
    assert.equal(hist.total, 20);
    assert.equal(hist.log.length, 1);
    assert.equal(hist.log[0].score, 20);
  });
});

test('integration [storage-cap]: history 達 MAX_HISTORY_LOG 後 trim', () => {
  runProfile('storage-cap', function storageCapTrim() {
    const log = Array.from({ length: MAX_HISTORY_LOG }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      steps: STREAK_STEP_GOAL,
      correct: 3,
      score: 35,
    }));
    const hist = { total: MAX_HISTORY_LOG * 35, streak: 1, lastDate: log.at(-1).date, log };
    const next = applyDailyResult(hist, {
      today: '2026-07-01',
      yesterday: log.at(-1).date,
      steps: STREAK_STEP_GOAL,
      correct: 3,
      score: 35,
    });
    assert.equal(next.log.length, MAX_HISTORY_LOG);
    assert.equal(next.log.at(-1).date, '2026-07-01');
    assert.notEqual(next.log[0].date, log[0].date, '最舊一筆應被裁掉');
  });
});
