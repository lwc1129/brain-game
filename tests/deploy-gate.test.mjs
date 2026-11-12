/**
 * 部署閘門與正式環境煙霧測試的 workflow 契約測試。
 * 鎖住「測試沒過不部署」「部署後實際打正式站」這兩件事不被無意間拿掉；
 * 只讀 workflow 檔，不發真實網路請求。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readWorkflow = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8');

// 取出某個 job 的區塊（從「  name:」到下一個同層 job 或檔尾）。
function jobBlock(yml, name) {
  const start = yml.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `找不到 job：${name}`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('deploy.yml 部署閘門', () => {
  const yml = readWorkflow('deploy.yml');

  test('deploy：先呼叫 test.yml，deploy job 依賴 test', () => {
    assert.match(jobBlock(yml, 'test'), /uses: \.\/\.github\/workflows\/test\.yml/);
    assert.match(jobBlock(yml, 'deploy'), /needs:\s*\[test\]/);
  });

  test('deploy：test 失敗時不部署（只接受 success 或 skipped）', () => {
    const block = jobBlock(yml, 'deploy');
    assert.match(block, /needs\.test\.result == 'success'/);
    assert.match(block, /needs\.test\.result == 'skipped'/);
    assert.doesNotMatch(block, /if:\s*always\(\)/);
  });

  test('deploy：只有呼叫方明確傳 skip_tests 才略過測試，預設為 false', () => {
    assert.match(yml, /skip_tests:[\s\S]*?type: boolean[\s\S]*?default: false/);
    assert.match(jobBlock(yml, 'test'), /if:\s*\$\{\{\s*!inputs\.skip_tests\s*\}\}/);
  });

  test('deploy：部署成功後呼叫 smoke-prod.yml，且不重複通知', () => {
    const block = jobBlock(yml, 'smoke');
    assert.match(block, /needs:\s*\[deploy\]/);
    assert.match(block, /needs\.deploy\.result == 'success'/);
    assert.match(block, /uses: \.\/\.github\/workflows\/smoke-prod\.yml/);
    assert.match(block, /skip_notify: true/);
  });
});

describe('test.yml 觸發條件', () => {
  const yml = readWorkflow('test.yml');
  const onBlock = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\npermissions:'));

  test('test：PR、手動、workflow_call 會跑', () => {
    assert.match(onBlock, /^  pull_request:/m);
    assert.match(onBlock, /^  workflow_dispatch:/m);
    assert.match(onBlock, /^  workflow_call:/m);
  });

  test('test：不由 push 直接觸發（main 上的測試由 deploy.yml 呼叫，避免跑兩次）', () => {
    assert.doesNotMatch(onBlock, /^  push:/m);
  });
});

describe('update_questions.yml 呼叫部署', () => {
  const yml = readWorkflow('update_questions.yml');

  test('update_questions：deploy 依賴 validate 成功，才可傳 skip_tests', () => {
    const block = jobBlock(yml, 'deploy');
    assert.match(block, /needs\.validate\.result == 'success'/);
    assert.match(block, /skip_tests: true/);
  });
});

describe('smoke-prod.yml', () => {
  const yml = readWorkflow('smoke-prod.yml');

  test('smoke-prod：支援 workflow_call、手動與每日排程', () => {
    assert.match(yml, /^  workflow_call:/m);
    assert.match(yml, /^  workflow_dispatch:/m);
    assert.match(yml, /^  schedule:/m);
    assert.match(yml, /cron: '5 1 \* \* \*'/);
  });

  test('smoke-prod：以允許的 Origin 對 AI_PROXY_URL 發 POST，要求 200 與正確題數', () => {
    assert.match(yml, /AI_PROXY_URL: \$\{\{ vars\.AI_PROXY_URL \}\}/);
    assert.match(yml, /-X POST "\$\{AI_PROXY_URL\}"/);
    assert.match(yml, /-H "Origin: \$\{SMOKE_ORIGIN\}"/);
    assert.match(yml, /"\$code" = "200"/);
    assert.match(yml, /\.questions \| length == \$n/);
  });

  test('smoke-prod：有限次重試與 curl 逾時，全部失敗才 exit 1', () => {
    assert.match(yml, /SMOKE_MAX_ATTEMPTS: '3'/);
    assert.match(yml, /-m "\$\{SMOKE_CURL_MAX_TIME_SECONDS\}"/);
    assert.match(yml, /exit 1\s*$/m);
  });

  test('smoke-prod：AI_PROXY_URL 未設定時只警告、不失敗', () => {
    assert.match(yml, /AI_PROXY_URL 未設定/);
  });

  test('smoke-prod：不使用任何金鑰', () => {
    assert.doesNotMatch(yml, /GEMINI_API_KEY/);
    assert.doesNotMatch(jobBlock(yml, 'smoke'), /secrets\./);
  });

  test('smoke-prod：失敗時通知 Slack，被呼叫且 skip_notify 時不通知', () => {
    const block = jobBlock(yml, 'notify-failure');
    assert.match(block, /uses: \.\/\.github\/workflows\/notify-slack-failure\.yml/);
    assert.match(block, /if:\s*\$\{\{\s*failure\(\) && !inputs\.skip_notify\s*\}\}/);
    assert.match(block, /workflow_name: Production smoke/);
  });
});
