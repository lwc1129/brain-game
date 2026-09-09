// js/render/helpers.js 的安全性關鍵函式測試。
// escapeHtml 是 AI 來源字串進入 DOM 前的唯一防線（見 CLAUDE.md 第 1 節），
// 必須涵蓋所有會被跳脫的字元與非字串輸入。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../js/render/helpers.js';

test('escapeHtml：跳脫 & < > " \' 五種字元', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeHtml：& 先跳脫避免雙重編碼', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('escapeHtml：不含特殊字元的字串原樣輸出', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
});

test('escapeHtml：非字串輸入先強制轉為字串再跳脫', () => {
  assert.equal(escapeHtml(123), '123');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
});

test('escapeHtml：阻擋常見 XSS payload 中的標籤與屬性', () => {
  const payload = `<img src=x onerror="alert(1)">`;
  const escaped = escapeHtml(payload);
  assert.ok(!escaped.includes('<img'));
  assert.ok(!escaped.includes('"alert(1)"'));
});
