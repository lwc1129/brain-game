# brain-game 開發標準

台灣銀髮族認知訓練遊戲。前端：GitHub Pages + Vanilla JS（ES modules）；後端：Vercel Serverless（`api/questions.js`）作為 Gemini AI proxy。無 build step，無外部 npm 依賴。

**測試指令：** `npm test`（Node.js 原生 test runner）、`python -m unittest test_generate_questions -v`

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

3. **AI 回應必須通過 `isValid*` 驗證後才使用**：`isValidQuestions()` 在 `api/questions.js` 和 `js/logic.js` 中均已實作（後者供前端驗證使用）。新增任何 Gemini call，必須先寫對應的 `isValid*` 函數和測試，才能在程式中消費 AI 回應。

4. **前端 DOM 插入必須過 `escapeHtml()`**：所有 AI 來源欄位（`q.q`, `q.a`, `q.opts[*]`）插入 HTML 前必須通過 `escapeHtml()`（位於 `js/app.js`）。禁止對 AI 來源字串直接使用 `innerHTML`。

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

**目前待改善（接手此 codebase 時優先補齊）：**
- `api/questions.js` line 143：`console.error(\`Gemini API error: ...\`)` 為非結構化字串，需改為上方格式。
- `api/questions.js` line 151–158：JSON parse 的兩個 catch block 目前靜默失敗，需補 error log。

### 前端（`js/ai.js`, `js/app.js`）

新增或修改 `logError(context, error)` utility（可放在 `js/app.js` 頂端或獨立 `js/logger.js`）：

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

套用位置：
- `js/ai.js` line 35：目前 `catch { return null; }` 為 silent swallow，需補 `logError('fetchFromProxy', e)`。
- `js/app.js` lines 49, 54：`console.warn` 可保留，但加上 `logError` 捕捉例外物件細節。

**Self-check（合併前回答）：**
- 新增的錯誤路徑有 `level`, `ts`, `msg`, `ctx` 四個欄位嗎？
- 有沒有任何 `catch {}` 或 `catch (e) { return null; }` 沒有 log 語句？

---

## 3. Unit Tests（單元測試）

### 現有模式（遵循）

- **執行：** `npm test`（`node --test tests/*.test.mjs`）
- **Mock helpers：** `makeReq()`, `makeRes()`, `stubFetch()`, `makeQuestion()`（位於 `tests/proxy.test.mjs`）
- **命名：** `test('functionName：描述具體行為', ...)`

### 規則

1. **Pure functions 必須有測試**：所有新增到 `js/logic.js`、`api/questions.js`、`generate_questions.py` 的純函數，在合併前必須有對應測試。

2. **新 request parameter**：每個新參數需測試：合法值、非法值（應回 400）、邊界值。參考 `proxy.test.mjs` 中 `difficulty` 的測試模式。

3. **新 `isValid*` 函數**：必須測試：合法結構（回 true）、至少 3 種非法結構（型別錯誤、缺少欄位、結構違規各一）。

4. **Gemini call mock**：測試中使用 `stubFetch()` 取代真實 fetch，禁止在測試中發出真實網路請求。

5. **合併前必須通過**：`npm test` 和 `python -m unittest test_generate_questions -v` 兩者都必須 exit 0。

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
| `storage-cap` | localStorage 歷史記錄達 `MAX_HISTORY_LOG` 上限 |

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

新增至 `.github/workflows/test.yml` 的 `integration-tests` job：

```yaml
- name: Run integration tests
  run: node --test tests/integration/*.test.mjs
```

**Self-check（新增遊戲功能時回答）：**
- 新的狀態轉換有對應的 integration test 涵蓋嗎？
- 測試輸出有每個 profile 的一行結果嗎？

---

## 5. Refactoring（定期重構）

**節奏：每 1–2 週**。AI 協助掃描技術債，有道理的直接全部改完。

### 技術債掃描清單

每次重構前，檢視以下項目：

- [ ] 函數超過 40 行（重點：`app.js` 的 `renderQ()` 已超過 60 行）
- [ ] 重複的驗證邏輯（`isValidQuestions` 在 `js/logic.js` 和 `api/questions.js` 各有一份，需評估是否應共用）
- [ ] Silent catch blocks 沒有 log（`js/storage.js` lines 6–17、`js/ai.js` line 35）
- [ ] 沒有命名的 magic numbers

### 規則

1. **PR description 必須有一行**：`Refactor: [what] — [why this reduces future pain]`
2. **重構前後都必須 `npm test` pass**；若重構導致測試失敗，修測試一起進同一個 PR。
3. **重構 PR 不得混入 feature 變更**；若重構是為了讓某功能更容易實作，拆成兩個 PR：先重構，再功能。

### 已知待處理項目（優先序）

1. 拆解 `app.js` 的 `renderStep`, `renderQ`, `renderComplete`, `renderLoading`，各不超過 30 行
2. 補上 Section 2 的結構化 log 至所有 silent catch
3. 評估 `isValidQuestions` 共用策略，並在選定的位置留下決策 comment

**Self-check（重構後回答）：**
- `npm test` 通過了嗎？
- PR description 有 `Refactor:` 那一行嗎？

---

## 6. Operations（維運機制）

**設計原則：無人值守面板。** 異常由 AI 偵測，自動開 issue，自動 hot-fix，Vercel 自動重新部署。

### 異常偵測閾值（需以 named constant 記錄在相關程式碼 comment 中）

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
| `MAX_TRACKED_KEYS` | `api/questions.js` line 21 | 10,000 | 限流表記憶體上限 |
| `RATE_LIMIT_MAX` | 環境變數 | 30 req | 每 IP 每視窗上限（scaling lever） |
| `RATE_LIMIT_WINDOW_MS` | 環境變數 | 60,000 ms | 限流視窗長度 |
| `FETCH_TIMEOUT_MS` | `js/ai.js` line 7 | 8,000 ms | 不可移除；防止前端 hang 死 |

### Hot-fix 協議

1. 針對性修改（不擴散到無關程式碼）
2. 必須同時更新或新增測試
3. 必須透過 PR（不直接 push main），讓 `ai-pr-review.yml` 執行多 agent review
4. Merge 後 Vercel 自動重新部署

**Self-check（新增錯誤路徑時回答）：**
- 這個錯誤從 log 就能診斷，不需要讀程式碼嗎？
- 錯誤 log 的 `ctx` 欄位包含足夠的診斷資訊嗎？
