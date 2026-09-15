/**
 * Issue #36 — failure notification workflow 契約測試。
 * 驗證題庫更新／部署在 failure path 會呼叫 Slack notify，
 * 且 payload 欄位完整；不發真實網路請求。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readWorkflow = (name) =>
  readFileSync(join(root, '.github', 'workflows', name), 'utf8');

describe('notify-slack-failure.yml', () => {
  const yml = readWorkflow('notify-slack-failure.yml');

  test('notify-slack-failure：支援 workflow_call 與 workflow_dispatch 驗證路徑', () => {
    assert.match(yml, /workflow_call:/);
    assert.match(yml, /workflow_dispatch:/);
  });

  test('notify-slack-failure：payload 含 workflow / result / branch / commit / run URL / timestamp', () => {
    assert.match(yml, /WORKFLOW_NAME/);
    assert.match(yml, /RESULT/);
    assert.match(yml, /BRANCH/);
    assert.match(yml, /COMMIT_SHA/);
    assert.match(yml, /RUN_URL/);
    assert.match(yml, /TIMESTAMP/);
    assert.match(yml, /\*Workflow\*/);
    assert.match(yml, /\*Result\*/);
    assert.match(yml, /\*Branch\*/);
    assert.match(yml, /\*Commit\*/);
    assert.match(yml, /\*Run\*/);
    assert.match(yml, /\*Timestamp\*/);
  });

  test('notify-slack-failure：沿用 SLACK_WEBHOOK_URL 與 curl POST pattern', () => {
    assert.match(yml, /secrets\.SLACK_WEBHOOK_URL/);
    assert.match(yml, /curl -sf --max-time 15 -X POST "\$SLACK_WEBHOOK_URL"/);
  });

  test('notify-slack-failure：curl 設有限 --max-time，失敗仍 warn + exit 0', () => {
    assert.match(yml, /--max-time 15/);
    assert.match(yml, /SLACK_CURL_MAX_TIME_SECONDS/);
    assert.match(yml, /set \+e/);
    assert.match(yml, /CURL_EXIT/);
    assert.match(yml, /original workflow failure is unchanged/);
    assert.match(yml, /exit 0\s*$/m);
  });

  test('notify-slack-failure：notification 失敗時仍 exit 0（不掩蓋 root cause）', () => {
    assert.match(yml, /set \+e/);
    assert.match(yml, /original workflow failure is unchanged/);
    assert.match(yml, /exit 0\s*$/m);
  });

  test('notify-slack-failure：缺少 webhook 時 skip 而不失敗', () => {
    assert.match(yml, /SLACK_WEBHOOK_URL is not set/);
    assert.match(yml, /skipping Slack failure notification/);
  });
});

describe('update_questions.yml failure notification', () => {
  const yml = readWorkflow('update_questions.yml');

  test('update_questions：failure path 會呼叫 notify-slack-failure', () => {
    assert.match(yml, /notify-failure:/);
    assert.match(yml, /uses: \.\/\.github\/workflows\/notify-slack-failure\.yml/);
    assert.match(yml, /always\(\) && contains\(needs\.\*\.result, 'failure'\)/);
  });

  test('update_questions：notify 依賴所有關鍵 jobs（含 generate／deploy）', () => {
    assert.match(
      yml,
      /needs:\s*\[generate,\s*validate,\s*commit,\s*deploy,\s*verify-production\]/
    );
  });

  test('update_questions：成功路徑條件不含 notify（僅 failure contains）', () => {
    // notify job 不得用 always() 無條件送成功告警
    const notifyBlock = yml.slice(yml.indexOf('notify-failure:'));
    assert.doesNotMatch(notifyBlock, /if:\s*always\(\)\s*$/m);
    assert.match(notifyBlock, /contains\(needs\.\*\.result, 'failure'\)/);
  });

  test('update_questions：notify commit_sha 優先 new_sha，否則 fallback github.sha', () => {
    const notifyBlock = yml.slice(yml.indexOf('notify-failure:'));
    assert.match(
      notifyBlock,
      /commit_sha:\s*\$\{\{\s*needs\.commit\.outputs\.new_sha\s*\|\|\s*github\.sha\s*\}\}/
    );
  });
});

describe('deploy.yml failure notification', () => {
  const yml = readWorkflow('deploy.yml');

  test('deploy：failure path 會呼叫 notify-slack-failure', () => {
    assert.match(yml, /notify-failure:/);
    assert.match(yml, /uses: \.\/\.github\/workflows\/notify-slack-failure\.yml/);
    assert.match(yml, /if:\s*failure\(\)/);
  });

  test('deploy：notify 只依賴 deploy job，成功時不觸發', () => {
    const notifyBlock = yml.slice(yml.indexOf('notify-failure:'));
    assert.match(notifyBlock, /needs:\s*\[deploy\]/);
    assert.match(notifyBlock, /if:\s*failure\(\)/);
    assert.doesNotMatch(notifyBlock, /if:\s*always\(\)/);
  });

  test('deploy：通知標示 Deploy to GitHub Pages 與 run URL', () => {
    const notifyBlock = yml.slice(yml.indexOf('notify-failure:'));
    assert.match(notifyBlock, /workflow_name:\s*Deploy to GitHub Pages/);
    assert.match(notifyBlock, /run_url:/);
    assert.match(notifyBlock, /commit_sha:/);
    assert.match(notifyBlock, /branch:/);
  });
});
