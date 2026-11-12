// js/analytics.js 測試：GA 呼叫失敗時不得丟出例外，且必須留下結構化 log。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window ?? {};
const { trackEvent } = await import('../js/analytics.js');

afterEach(() => {
  delete window.gtag;
});

test('trackEvent：gtag 不存在時直接略過', () => {
  assert.doesNotThrow(() => trackEvent('start_game', {}));
});

test('trackEvent：正常時把事件交給 gtag', () => {
  const calls = [];
  window.gtag = (...args) => calls.push(args);
  trackEvent('start_game', { steps: 100 });
  assert.deepEqual(calls, [['event', 'start_game', { steps: 100 }]]);
});

test('trackEvent：gtag 丟出例外時不中斷遊戲，並記錄結構化 error log', () => {
  window.gtag = () => {
    throw new Error('gtag boom');
  };
  const logs = [];
  const orig = console.error;
  console.error = (m) => logs.push(m);
  try {
    assert.doesNotThrow(() => trackEvent('complete_game', {}));
  } finally {
    console.error = orig;
  }
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.level, 'error');
  assert.ok(entry.ts);
  assert.equal(entry.msg, 'gtag boom');
  assert.deepEqual(entry.ctx, { op: 'trackEvent', event: 'complete_game' });
});
