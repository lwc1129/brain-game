# brain-game 開發標準

台灣銀髮族認知訓練遊戲。前端：GitHub Pages + Vanilla JS（ES modules）；後端：Vercel Serverless（`api/questions.js`）作為 Gemini AI proxy。無 build step，無外部 npm 依賴。

**測試指令：**
- `npm test`：單元測試 + 整合測試（Node.js 原生 test runner，含 `tests/integration/`）
- `npm run test:e2e`：瀏覽器端到端 smoke test（需 playwright；CI 以 `npm install --no-save` 安裝，不寫入 `package.json`）
- `python -m unittest test_generate_questions test_difficulty_eval -v`（乾淨環境若沒有 `python` 指令，改用 `python3`）

**部署內容：** GitHub Pages 只上傳 `scripts/build_site.sh` 組出的 `_site/`（`index.html`、`css/`、`js/`、`assets/`、`questions.json`）。新增前端執行期檔案時必須同步更新該腳本，否則 e2e 的 `site-files` 測試會失敗。

---

## 1. Security（資訊安全 + AI 安全）

### 現有防線（不得削弱）

- **Origin allowlist**：`api/questions.js` 在任何處理前先驗證 origin，來源不符直接 403。
- **Enum 驗證**：`DIFFICULTIES.has(difficulty)` 過濾非法值，驗證失敗直接 400。
- **Rate limiting**：`checkRateLimit()` 在呼叫 Gemini 之前執行，保護 API 配額。
- **API key**：`GEMINI_API_KEY` 只存在 Vercel 環境變數，絕不出現在前端程式碼。

每次修改 `api/questions.js` 或新增 Gemini 相關程式碼時，PR description 必須說明這四項防線仍完整保留。

### Prompt Injection 防禦

1. **輸入不可 raw interpolate 進 prompt**：`buildPrompt()` 中 `diffKey` 已通過 `DIFFICULTIES.has()` 白名單驗證後才使用。未來新增任何 prompt 參數，必須先通過明確的白名單或 enum 驗證，再插入 prompt 字串。

2. **新 prompt 必須有封閉指令**：每個 `buildPrompt`-style 函數的最後一行必須包含封閉指令，如現有的 `只回傳JSON陣列，不要其他文字或markdown`，防止模型輸出任意文字。

3. **AI 回應必須通過 `isValid*` 驗證後才使用**：`isValidQuestions()` 只定義在 `js/logic.js`，`api/questions.js` 直接 import 同一份，前後端共用、不會漂移。它檢查結構、題型白名單（`QUESTION_TYPES`）、長度上限（`MAX_QUESTION_LEN` / `MAX_OPTION_LEN`），並驗算純算式題的答案（`checkArithmeticAnswer`）。新增任何 Gemini call，必須先寫對應的 `isValid*` 函數和測試，才能在程式中消費 AI 回應。`generate_questions.py` 的 `describe_question_defect` 必須與 `isValidQuestion` 保持同一套規則（有測試鎖住）。

4. **前端 DOM 插入必須過 `escapeHtml()`**：所有 AI 來源欄位（`q.q`, `q.a`, `q.opts[*]`）插入 HTML 前必須通過 `escapeHtml()`（位於 `js/render/helpers.js`）。禁止對 AI 來源字串直接使用 `innerHTML`。e2e 的 `xss` 測試會以惡意題庫實際驗證這一點。

**Self-check（合併前回答）：**
- 每個新的 prompt 參數都有白名單驗證嗎？
- 每個新的 AI 回應都有 `isValid*` 函數擋在使用之前嗎？
- 所有 AI 來源字串都通過 `escapeHtml()` 才進入 DOM 嗎？

---

## 2. Logging（日誌機制）

不寫 log 等於讓排查問題的人在黑暗中操作。每次新增錯誤路徑都必須有足夠的 log，讓人不用讀程式碼也能從 log 診斷問題。

### 後端（`api/questions.js`）—— 結構化 JSON log

所有 `console.*` 調用必須使用以下結構化格式：

```js
console.error(JSON.stringify({
  level: 'error',    // 'info' | 'warn' | 'error'
  ts: new Date().toISOString(),
  msg: '人類可讀的描述',
  ctx: { /* 診斷所需的相關欄位 */ }
}));
```

**必須記錄的事件：**

| 事件 | level | ctx 必填欄位 |
|------|-------|-------------|
| origin 被拒絕（403） | `warn` | `origin` |
| rate limit 觸發（429） | `warn` | `clientKey`, `remaining: 0` |
| Gemini call 嘗試 | `info` | `diffKey` |
| Gemini 回應非 2xx | `error` | `status`, `statusText`, `diffKey` |
| JSON 解析失敗 | `error` | `diffKey`, `rawLength` |
| isValidQuestions 驗證失敗 | `error` | `diffKey`, `count` |
| 成功回應 | `info` | `diffKey`, `count` |
| Gemini 呼叫例外（逾時、網路錯誤、body 非 JSON） | `error` | `diffKey`, `errorName`, `error`, `timeoutMs` |

### 前端（`js/` 各模組）

使用 `js/logger.js` 的 `logError(context, error)`：

```js
function logError(context, error) {
  console.error(JSON.stringify({
    level: 'error',
    ts: new Date().toISOString(),
    ctx: context,
    msg: error?.message ?? String(error)
  }));
}
```

已套用：`js/ai.js`（proxy 呼叫失敗）、`js/app.js`（題庫載入失敗）、`js/storage.js`（localStorage 讀寫失敗）、`js/render/complete.js`（分享 / 複製失敗；使用者自行取消分享不記錄）。

**Self-check（合併前回答）：**
- 新增的錯誤路徑有 `level`, `ts`, `msg`, `ctx` 四個欄位嗎？
- 有沒有任何 `catch {}` 或 `catch (e) { return null; }` 沒有 log 語句？

---

## 3. Unit Tests（單元測試）

### 現有模式（遵循）

- **執行：** `npm test`（`node --test tests/*.test.mjs tests/integration/*.test.mjs`）
- **Mock helpers：** `makeReq()`, `makeRes()`, `stubFetch()`, `makeQuestion()`（位於 `tests/proxy.test.mjs`）；localStorage 以記憶體 stub 取代（見 `tests/storage.test.mjs`）
- **render 層：** `build*Html` 等純字串函式直接在 Node 測試；需要 DOM 的 `bind*` 行為由 e2e 涵蓋
- **命名：** `test('functionName：描述具體行為', ...)`

### 規則

1. **Pure functions 必須有測試**：所有新增到 `js/logic.js`、`api/questions.js`、`generate_questions.py` 的純函數，在合併前必須有對應測試。

2. **新 request parameter**：每個新參數需測試：合法值、非法值（應回 400）、邊界值。參考 `proxy.test.mjs` 中 `difficulty` 的測試模式。

3. **新 `isValid*` 函數**：必須測試：合法結構（回 true）、至少 3 種非法結構（型別錯誤、缺少欄位、結構違規各一）。

4. **Gemini call mock**：測試中使用 `stubFetch()` 取代真實 fetch，禁止在測試中發出真實網路請求。

5. **合併前必須通過**：`npm test`、`npm run test:e2e`、`python -m unittest test_generate_questions test_difficulty_eval -v` 都必須 exit 0（CI 的 `js-tests`、`e2e-tests`、`python-tests` job）。

**Self-check（合併前回答）：**
- 每個新的 exported function 都有至少一個 pass case 和一個 edge/fail case 嗎？
- `npm test` 通過了嗎？

---

## 4. Integration Tests（整合測試）

整合測試替代人工測試，模擬多個使用者跑完所有 test cases 並產生個別報告。

### 架構

- **目錄：** `tests/integration/`
- **Runner：** Node.js 原生 `node:test`，無需新依賴
- **原則：** 不觸碰 DOM，不發真實網路請求；組合現有 pure functions 模擬完整遊戲流程

### 標準使用者 Profiles（建立整合測試時必須涵蓋）

| Profile | 說明 |
|---------|------|
| `new-user` | 空歷史記錄，第一次遊戲 |
| `streak-10` | 連續遊玩 10 天（streak = 10） |
| `broken-streak` | lastDate 為 2 天前，streak 應歸零 |
| `retry-flow` | 完成後 revert，再重新 apply |
| `storage-cap` | localStorage 歷史記錄達 `MAX_HISTORY_LOG` 上限；累積天數（`playedDays`）不受截斷影響 |

### Proxy 整合測試序列

```
OPTIONS preflight
→ POST valid difficulty
→ POST rate limit exceeded（連打超過閾值）
→ POST from disallowed origin
```

### 報告格式

每個 test case 輸出一行：

```
PASS [new-user]: 空歷史記錄首次遊戲完整流程
FAIL [streak-10]: 連續天數計算錯誤 — 預期 10，實際 0
```

### CI 整合

整合測試已包含在 `npm test` 的 glob 中，由 `.github/workflows/test.yml` 的 `js-tests` job 執行，不需另開 job。

### 端到端 smoke test（`tests/e2e/`）

以真實 Chromium（iPhone 13 尺寸）操作 `scripts/build_site.sh` 產出的網站，不發外部網路請求。現有 profile：

| Profile | 驗證 |
|---------|------|
| `new-user` | 首次遊玩完整流程，完成頁統計正確 |
| `invalid-steps` | 步數不合法時顯示頁內錯誤 |
| `retry-flow` | 重新挑戰需頁內確認（Escape 可取消） |
| `xss` | 題庫中的惡意字串只顯示為文字 |
| `xl-font` | 特大字體下無水平捲動 |
| `site-files` | `index.html` 引用的檔案都在部署內容中 |

每個 e2e 測試都會斷言：無 page error、無原生 `alert` / `confirm` / `prompt`、無 404。

**Self-check（新增遊戲功能時回答）：**
- 新的狀態轉換有對應的 integration test 涵蓋嗎？
- 測試輸出有每個 profile 的一行結果嗎？

---

## 5. Refactoring（定期重構）

**節奏：每 1–2 週**。AI 協助掃描技術債，有道理的直接全部改完。

### 技術債掃描清單

每次重構前，檢視以下項目：

- [ ] 函數超過 40 行
- [ ] 重複的驗證邏輯（前後端、JS 與 Python 之間）
- [ ] Silent catch blocks 沒有 log
- [ ] 沒有命名的 magic numbers

### 規則

1. **PR description 必須有一行**：`Refactor: [what] — [why this reduces future pain]`
2. **重構前後都必須 `npm test` pass**；若重構導致測試失敗，修測試一起進同一個 PR。
3. **重構 PR 不得混入 feature 變更**；若重構是為了讓某功能更容易實作，拆成兩個 PR：先重構，再功能。

### 已知待處理項目（優先序）

1. `js/analytics.js` 的 `trackEvent` 仍有 `catch {}`：GA 失敗不應影響遊戲，但應補 `logError`。
2. `api/questions.js` 的 `callGemini` 約 90 行，可拆出「呼叫」與「解析 + 驗證」兩段。
3. `generate_questions.py` 尚未對純算式題做答案驗算（前端 `checkArithmeticAnswer` 只用於 AI 即時出題）。

已完成（保留紀錄避免重複評估）：render 層已拆到 `js/render/`；silent catch 已補 log；`isValidQuestions` 已決定只放 `js/logic.js` 由 proxy import。

**Self-check（重構後回答）：**
- `npm test` 通過了嗎？
- PR description 有 `Refactor:` 那一行嗎？

---

## 6. Operations（維運機制）

**設計原則：無人值守面板。** 異常由 AI 偵測，自動開 issue，自動 hot-fix，Vercel 自動重新部署。

### 異常偵測閾值（需以 named constant 記錄在相關程式碼 comment 中）

> **尚未實作**：目前沒有異常偵測 workflow，以下為規劃。實作前，Gemini 502 只能從 Vercel 執行記錄人工查看（Hobby 方案只保留 1 小時）。

| 異常類型 | 閾值 | 判斷 |
|---------|------|------|
| Gemini 服務中斷 | 5 分鐘內 502 比率 > 10% | Gemini 端問題 |
| 濫用攻擊 | 短時間大量不同 IP 觸發 429 | 需收緊 `RATE_LIMIT_MAX` |

### 自動開 Issue 格式

當異常偵測 GitHub Actions workflow 觸發時，使用以下格式（參考 `ai-pr-review.yml` 的 `gh` CLI + `GH_TOKEN` 模式）：

```
Title: [ops] Anomaly detected: <type>
Body:  結構化 log 證據（timestamp, error counts, ctx）
Labels: ops, auto
```

### Auto-scaling 上限（不得在無分析的情況下調整）

| 常數 | 位置 | 現值 | 說明 |
|------|------|------|------|
| `MAX_TRACKED_KEYS` | `api/questions.js` | 10,000 | 限流表記憶體上限 |
| `RATE_LIMIT_MAX` | 環境變數 | 30 req | 每 IP 每視窗上限（scaling lever） |
| `RATE_LIMIT_WINDOW_MS` | 環境變數 | 60,000 ms | 限流視窗長度 |
| `FETCH_TIMEOUT_MS` | `js/ai.js` | 8,000 ms | 不可移除；防止前端 hang 死 |
| `GEMINI_TIMEOUT_MS` | `api/questions.js` | 7,000 ms | 必須小於 `FETCH_TIMEOUT_MS`，讓 proxy 先放棄並留下 log（有測試鎖住） |
| `GEMINI_MAX_OUTPUT_TOKENS` | `api/questions.js` | 1,024 | 搭配 `thinkingBudget: 0`；調低可能截斷 JSON |
| `RECENT_LIMIT` | `js/storage.js` | 240 題 | 每難度「近期出過」記錄；必須小於題庫每難度上限 300 |

位置不寫行號，避免程式碼變動後失準；以常數名稱搜尋即可。

### 環境變數設定注意

Vercel 的環境變數分 Production / Preview。`GEMINI_API_KEY` 若只勾 Production，預覽部署會回 503 `proxy not configured`，無法在合併前驗證 AI 出題。

### Hot-fix 協議

1. 針對性修改（不擴散到無關程式碼）
2. 必須同時更新或新增測試
3. 必須透過 PR（不直接 push main），讓 `ai-pr-review.yml` 執行多 agent review
4. Merge 後 Vercel 自動重新部署

**Self-check（新增錯誤路徑時回答）：**
- 這個錯誤從 log 就能診斷，不需要讀程式碼嗎？
- 錯誤 log 的 `ctx` 欄位包含足夠的診斷資訊嗎？
