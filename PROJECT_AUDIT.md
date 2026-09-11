# PROJECT_AUDIT.md

> brain-game 接手盤點報告
> 盤點日期：2026-09-11　·　盤點基準：`main` @ `86e5ef1`（2026-09-09）
> 盤點分支：`claude/brain-game-audit-127z3l`
> 盤點方式：全 repo 原始碼閱讀 + 實際執行測試 + Chromium 實跑主流程 + GitHub Actions 執行歷史查核

---

## Executive Summary

brain-game 是一個**已上線、核心迴圈完整可玩**的單頁靜態遊戲，工程品質遠高於一般個人專案：
模組化 ES modules、120 個自動化測試（78 JS + 42 Python）、後端 proxy 有 origin allowlist／
enum 驗證／限流／結構化 log 四道防線、無障礙設計（字體縮放、ARIA、focus-visible、
prefers-reduced-motion）都實際落地，不是文件上的宣稱。**沒有任何 TODO/FIXME/HACK 標記，
沒有 open issue，沒有 open PR，working tree 乾淨。**

但盤點過程找到三件**用讀 code 讀不出來、必須查 runtime 與 CI 歷史才會浮現**的問題：

| # | 問題 | 影響 | 證據 |
|---|------|------|------|
| **1** | 每週自動更新的題庫**從未送達線上** | 招牌功能實質失效近 2 個月 | Deploy 執行 #37（07-10）→ #38（09-09），中間 8 次題庫 commit 進了 main 卻**零次部署** |
| **2** | 「返回主頁」後重玩會**重複計分** | 同一天出現 2 筆記錄、分數灌水 | 已在 Chromium 實測重現（total 20→30、log 2 筆同日） |
| **3** | 題庫生成依賴**已終止支援**的 SDK，且失敗無人知道 | 13 次排程中 3 次全失敗（23%） | Actions log：`All support for the google.generativeai package has ended` |

問題 1 是**真正的阻塞**：它讓「每週自動更新題庫」這個產品主張在使用者端不成立，
而且連帶使 CI 的 `questions.json` schema 驗證對自動產生的內容從未執行過。
問題 2 是資料正確性缺陷，但它走的是一般 push 路徑，不受問題 1 阻塞。

**產品階段判定：MVP。**
**唯一下一步：修復「題庫自動更新 → GitHub Pages」的交付斷點**（詳見最後一節）。

---

## Product Overview

### 解決什麼問題

台灣家庭裡的長輩需要規律的認知刺激與身體活動，但既有方案不是要下載 App、要註冊帳號，
就是題目對銀髮族太難或太幼稚。本產品用**一個「走路步數換題目難度」的機制**，
把「今天有沒有動」和「今天有沒有動腦」綁在同一個每日儀式裡：
走得多 → 題目輕鬆（獎勵）；走得少 → 題目變難（補回來）。

### 主要使用者

- **直接使用者**：台灣銀髮族長輩（繁體中文、字體可放大到 130%、觸控目標 ≥48px）。
- **實際導入者（推測）**：子女／照顧者——分享文案（`buildShareText`）產出的是
  「傳給家人」格式，完成頁文案明寫「把今日成果傳給家人 😊」。
  這代表**產品的傳播單位是家庭，不是個人**。

### 核心使用情境

每天一次、3 分鐘內完成：開啟網頁 → 輸入今天步數 → 答 3 題 → 看成果卡 → 截圖或複製傳給家人。

### 核心價值

1. **零摩擦**：免下載、免註冊、免登入。開網頁就能玩（實測確認）。
2. **步數 ↔ 難度的耦合**：這是產品唯一的原創機制，也是它和「隨便一個腦力測驗網站」的差別。
3. **連續達標天數（streak）**：步數 ≥ 3000 才計入，把遊戲變成運動習慣的外掛。

### 主要功能（依實作確認）

| 功能 | 位置 | 狀態 |
|------|------|------|
| 步數輸入 → 四級難度判定 | `js/logic.js:getDiff` | 完整 |
| 每日 3 題選擇題 + 即時對錯回饋 | `js/render/question.js` | 完整 |
| 計分（每題 +10、全對 +5） | `js/logic.js:computeScore` | 完整 |
| 連續達標天數 + 累積分數 + 最近 5 筆記錄 | `js/logic.js:applyDailyResult` | 完整（有重複計分缺陷） |
| 1200 題靜態題庫 + 近期 60 題排除 | `questions.json` / `js/storage.js` | 完整 |
| 120 題內建 fallback（離線可玩） | `js/fallback-questions.js` | 完整（實測 404 後仍可玩） |
| AI 即時出題（Gemini via proxy） | `api/questions.js` / `js/ai.js` | **線上狀態未知**（見 Open Questions） |
| 分享文字複製 | `js/render/complete.js` | 完整 |
| 字體大小切換（100/115/130%） | `js/app.js:initFontControls` | 完整（實測含重整續存） |
| 重新挑戰（扣分後重玩） | `js/app.js:renderComplete` | 完整 |
| GA4 事件追蹤 | `js/analytics.js` | 完整（線上是否啟用未知） |
| 贊助連結（portaly.cc） | `index.html` / 完成頁 | 完整 |

### 次要功能

GA4 分析、贊助 CTA、SEO/OG meta、AI 出題 loading 動畫輪播文案、出題來源標籤（AI／題庫）。
其中「出題來源標籤」在 AI 未啟用時永遠顯示「📚 題庫出題」——功能正確，但**這個 UI 的設計
意圖（讓使用者感受到 AI 價值）在 AI 關閉時完全沒有作用**。

### 完整使用者流程與實際可用到哪一步

```
開啟網頁
  → [步數頁] 輸入步數，即時顯示難度徽章        ✅ 實測通過
  → 按「開始今日挑戰」
      → aiEnabled() ? [Loading 頁 + 輪播文案] → AI 出題（8s timeout）
                    : 直接抽題庫                ✅ 實測通過（AI 路徑未在線上驗證）
      → AI 失敗 → 自動降級題庫                  ✅ 實測通過
      → questions.json 404 → 降級內建 fallback  ✅ 實測通過
  → [答題頁] 逐題作答，即時綠/紅回饋            ✅ 實測通過
  → 三題皆答 → 出現「完成！查看今日成果」       ✅ 實測通過
  → [完成頁] 成果卡 + 分享 + 重新挑戰 + 返回    ✅ 實測通過
  → 重整頁面 → 停在正確的階段                   ✅ 實測通過（含答到一半重整）
  → 「返回主頁」→ 再玩一次                      ❌ 重複計分（已重現）
```

**可用到最後一步。** 這不是半成品——一般使用者從頭到尾跑完不會卡住。

### 哪些只是 prototype / 哪些接近 production

| 接近 production | 只是 prototype 寫法 |
|---|---|
| `js/logic.js` 純函式層（無副作用、全測試覆蓋） | `api/questions.js` 的記憶體限流（單實例、冷啟動即歸零，程式碼自己也寫明了） |
| `api/questions.js` 的四道安全防線與結構化 log | `rebalance_questions.py`／`seed_questions.py`（一次性腳本，不在任何自動流程中） |
| `tests/`（78 JS + 42 Python，含 mock、含整合序列） | CLAUDE.md §6「無人值守維運面板」——閾值、自動開 issue **完全未實作** |
| 三層題目降級鏈（AI → questions.json → 內建） | `js/app.js` 的 `_data` / `_hist` 模組級可變全域狀態 |
| 無障礙實作（非文件宣稱，實測有效） | 沒有任何 linter／formatter |

### README、註解與實作的落差（明確列出）

| 位置 | 文件說 | 實際是 |
|---|---|---|
| `README.md` | 「node --test tests/*.test.mjs（共 40 個測試）」 | **78 個**，且指令已改為 `npm test`（含 integration） |
| `README.md` | 「python -m unittest（20 個測試）」 | **42 個** |
| `README.md` | 「GitHub Actions 每週自動擴充」 | 有擴充進 repo，但**沒有部署到線上**（見 P0-1） |
| `CLAUDE.md` §2 | 「`api/questions.js` line 143 為非結構化字串，需改」 | **已修好**（現為結構化 log）；行號也已過期 |
| `CLAUDE.md` §2 | 「`js/ai.js` line 35 silent swallow」 | **已修好**（`logError('fetchFromProxy', e)`） |
| `CLAUDE.md` §5 | 「已知待處理：拆 renderQ、補 log、評估 isValidQuestions 共用」 | **三項全部已完成**（`js/render/` 已拆、log 已補、`api` 已 import 前端的 `isValidQuestions`） |
| `CLAUDE.md` §4 | 要求 `test.yml` 新增 `integration-tests` job | **不存在**（改由 `npm test` 的 glob 涵蓋，結果等價但與規範文字不符） |
| `CLAUDE.md` §6 | 異常偵測閾值、自動開 issue workflow | **完全不存在**，無對應 workflow、無 named constant |
| `js/logic.js:17` 註解 | 「MAX_STEPS 與 index.html #si 的 max 屬性對齊」 | `#si` 已搬到 `js/render/step.js`，`index.html` 內無此元素 |

**結論：文件不是誇大，而是落後。** 開發標準文件描述的多數待辦其實已經做完，
反而讓文件失去「待辦清單」的功能。

---

## Product Stage

# 🟡 MVP

### 判斷依據

| 證據 | 指向 |
|---|---|
| 已上線於 GitHub Pages，有 canonical URL、OG/Twitter meta、favicon | 不是 PROTOTYPE |
| 核心迴圈端到端可用，實測無斷點 | 不是 PROTOTYPE |
| 有 GA4 事件追蹤、有贊助連結 | 已在嘗試驗證與變現 |
| 有 CI、有 120 個測試、有 code review 自動化 | 工程成熟度超過一般 MVP |
| **沒有任何真實使用數據可查**（GA 是否啟用未知，repo 內無留存/DAU 紀錄） | 尚未進入 PILOT |
| **沒有任何監控、告警、on-call**；排程失敗 3 次無人知曉 | 未達 PRODUCTION |
| **核心交付管線實際是斷的**（P0-1） | 未達 PRODUCTION |
| AI 差異化功能在線上的開關狀態無人能確認 | 未達 PILOT |

「有 PRODUCTION 等級的工程實踐，但沒有 PRODUCTION 等級的維運與驗證」——這正是 MVP。

### 進入下一階段（PILOT）還缺什麼

1. **交付可信**：main 上的任何變更（含自動化產生的）都能被驗證確實送達線上。
2. **資料正確**：使用者看到的分數與天數不會因為操作路徑不同而出錯。
3. **基本可觀測**：知道有多少人玩、玩到哪一步流失、AI 路徑有沒有在跑。
4. **一組真實使用者**：哪怕只有 10 個家庭，有 2 週的實際留存資料。

### 現在最不應該投入的工作

- ❌ **大型重構**：`js/` 才剛在 PR #30 拆解完，架構是乾淨的，再動是內耗。
- ❌ **換技術棧／導入框架**：無 build step 是這個專案的資產（零依賴、零供應鏈風險、
  改完重整就好）。導入 React/Vite 會換來一堆維護成本卻換不到任何使用者價值。
- ❌ **補滿測試覆蓋率**：已有 120 個測試，缺口只有一處（DOM/E2E），不需要全面補。
- ❌ **新功能**（排行榜、多人、更多題型）：在交付管線修好、能看到真實留存之前，
  新功能只是增加未被驗證的表面積。

---

## User Flow

### 主流程（Happy Path）

```
┌──────────────┐
│  進入首頁     │  initAnalytics → initFontControls → fetchQuestionBank → init
└──────┬───────┘  失敗時 QB 保持內建 fallback（不阻斷）
       │
       ├─ _data.completed?  ──Yes──► [完成頁]
       ├─ _data.steps == null? ─Yes─► [步數頁]
       └─ else ──────────────────────► [答題頁]
```

### 三個畫面狀態的轉換

| From | 觸發 | To | 持久化 |
|---|---|---|---|
| 步數頁 | 輸入步數（input 事件） | 步數頁（顯示難度徽章 + 400ms debounce 預抓 AI） | 無 |
| 步數頁 | 開始挑戰（合法步數） | Loading 頁 → 答題頁 | ✅ `saveTodayData` |
| 步數頁 | 開始挑戰（空白/超限/負數） | 停留 + `alert('請輸入有效步數')` | 無 |
| 答題頁 | 點選項 | 答題頁（該題 disabled + 顯示對錯） | ✅ 每題即存 |
| 答題頁 | 三題皆答 → 完成 | 完成頁 | ✅ `saveTodayData` + `saveHistory` |
| 完成頁 | 複製分享文字 | 完成頁（按鈕文字 2 秒回饋） | 無 |
| 完成頁 | 重新挑戰（confirm） | 步數頁（已扣分、已換 AI 版號） | ✅ revert + 清空 |
| 完成頁 | **返回主頁** | 步數頁 | ❌ **未持久化** ← 缺陷根源 |

### 實測跑過的流程（Chromium headless，390×844 與 1280×900）

```
PASS [smoke]: 首頁載入 title="每日認知挑戰｜給長者的免費腦力訓練遊戲"
PASS [smoke]: 步數輸入即時顯示難度 → "難度：簡單 👍　走得不錯！獎勵輕鬆題目～"
PASS [smoke]: 開始挑戰 → 3 題，來源="📚 今日由題庫出題"
PASS [smoke]: 三題作答完成，完成按鈕出現=true
PASS [smoke]: 完成頁 → 🔥 連續達標 1 天（累積分數依隨機作答結果而異）
PASS [smoke]: 重整後仍停在完成頁（localStorage 續存）
PASS [smoke]: 返回主頁可用，統計列出現=true
PASS [edge]:  空白步數按開始 → alert="請輸入有效步數"
PASS [edge]:  超過上限 999999 → 難度徽章不顯示, alert="請輸入有效步數"
PASS [edge]:  0 步 → 困難題目出現 (困難 💪)
PASS [edge]:  答一題後重整 → 已作答題數保留=1
PASS [desktop]: 字體切換 100% → 130%，重整後=130%
PASS [desktop]: 無水平溢出；.q-options 桌機雙欄 (400.7px 400.7px)
PASS [fallback]: questions.json 404 → 仍可出題 (3 題，內建 fallback)
FAIL [bug]:   完成 → 返回主頁 → 重玩 → 完成 → 同日 2 筆記錄、total 20→30
```

---

## Repository Map

```
brain-game/
├── index.html                      45 行。純骨架 + SEO/OG meta。無樣式無邏輯。
├── css/styles.css                 142 行。CSS variables、rem、兩個斷點、a11y、reduced-motion。
├── js/
│   ├── config.js                   11 行。CI 注入點（GA_MEASUREMENT_ID / AI_PROXY_URL），提交時為空。
│   ├── logic.js                   163 行。★ 純函式核心：難度、抽題、計分、streak、驗證。零副作用。
│   ├── storage.js                 104 行。localStorage 封裝，全部 catch 都有 logError。
│   ├── ai.js                       64 行。AI 出題：8s timeout、inflight dedup、每日快取、驗證後才回傳。
│   ├── analytics.js                22 行。GA4，未設 ID 時直接 return。
│   ├── logger.js                   10 行。結構化 error log（level/ts/ctx/msg）。
│   ├── fallback-questions.js      132 行。內建 120 題（各難度 30）。離線保底。
│   ├── app.js                     258 行。進入點：狀態擁有者 + 事件協調。★ 全專案唯一的可變狀態所在
│   └── render/
│       ├── helpers.js              49 行。escapeHtml（★ XSS 唯一防線）、統計列、歷史列、來源標籤。
│       ├── step.js                 54 行。步數頁 HTML + 輸入綁定 + 預抓 debounce。
│       ├── question.js             66 行。答題頁 HTML + 選項綁定。所有 AI 字串在此過 escapeHtml。
│       ├── loading.js              19 行。Loading 卡 + 文案輪播 interval。
│       └── complete.js             67 行。成果卡 + 分享文字 + 複製/重試/返回綁定。
├── api/
│   └── questions.js               281 行。★ Vercel Serverless：Gemini proxy。四道防線 + 全路徑結構化 log。
├── questions.json                 250KB / 1200 題。GitHub Actions 每週改寫。★ 已達 300/難度 上限。
├── generate_questions.py          365 行。每週擴充：prompt → 解析 → 驗證 → 跨難度去重 → 配額 → 上限淘汰。
├── seed_questions.py              718 行。一次性種題（固定種子可重現）。★ 不在任何自動流程中。
├── rebalance_questions.py         146 行。一次性重平衡（2026-07 用過一次）。★ 不在任何自動流程中。
├── test_generate_questions.py     380 行 / 42 測試。
├── tests/
│   ├── logic.test.mjs             285 行 / 25 測試
│   ├── proxy.test.mjs             527 行 / 32 測試（含 handler 端到端、限流序、log 斷言）
│   ├── ai.test.mjs                159 行 /  7 測試（mock fetch、timeout、dedup）
│   ├── render-helpers.test.mjs     32 行 /  4 測試（escapeHtml XSS）
│   └── integration/
│       ├── game-flow.test.mjs     144 行 /  5 profile（new-user / streak-10 / broken-streak / retry-flow / storage-cap）
│       └── proxy-flow.test.mjs    120 行 /  1 序列（OPTIONS → POST → 429 → 403）
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml              57 行。push main → 注入 config → GitHub Pages。
│   │   ├── test.yml                54 行。push/PR → python + npm test + questions.json schema 驗證。
│   │   ├── update_questions.yml    42 行。每週日 UTC 19:00 → Gemini → commit + push。★ 斷點所在
│   │   └── ai-pr-review.yml       148 行。PR → Claude + Gemini 雙 agent review → Slack 通知。
│   └── agents/{claude,gemini}-reviewer.md   review agent 角色定義。
├── assets/
│   ├── favicon.svg                 index.html 引用 ✅
│   ├── og-image.png                index.html 引用 ✅
│   └── og-image.svg                ★ 無任何引用（PNG 的原始檔，dead asset）
├── package.json                    僅 name/private/type/scripts.test。★ 零依賴、無 lockfile。
├── .nojekyll                       GitHub Pages 不跑 Jekyll。
├── .gitignore                      僅 __pycache__/ 與 *.pyc。
├── README.md                       產品/安全/題庫/無障礙/開發/部署說明。★ 數字已過期。
├── CLAUDE.md                       六大開發標準（Security/Logging/Tests/Refactor/Ops）。★ 待辦已過期。
└── AGENTS.md                       Cursor Cloud 環境說明（python vs python3 的坑）。
```

### 未使用 / dead code

| 項目 | 判定 |
|---|---|
| `assets/og-image.svg` | **Dead asset**。無任何引用。P3。 |
| `seed_questions.py`（718 行） | **不是 dead**——被 `rebalance_questions.py` import，且是 1200 題的可重現來源。屬「歸檔腳本」。 |
| `rebalance_questions.py`（146 行） | **一次性已執行完畢**（2026-07-07 commit `0a1d473`）。有 5 個測試守著。屬「歸檔腳本」。 |
| `js/` 全部模組 | 無 dead code。每個 export 都有呼叫端。 |
| TODO / FIXME / HACK | **全 repo 零筆**（已 grep 確認）。 |

---

## Current Architecture

### 架構圖（實際還原）

```
┌─────────────────────────────────────────────────────────────────┐
│ 使用者瀏覽器                                                      │
│                                                                 │
│  index.html ──► js/app.js (ES module entry)                     │
│                    │                                            │
│    State ──────────┤  模組級可變變數：QB / _data / _hist          │
│                    │  （無 store、無框架、無 reactive system）     │
│                    │                                            │
│    Service ────────┼──► js/logic.js    純函式（可 Node 直測）      │
│                    ├──► js/storage.js  localStorage 封裝          │
│                    ├──► js/ai.js       AI 出題 + timeout + cache  │
│                    └──► js/render/*    HTML 字串 + 事件綁定        │
│                    │                                            │
│    Data Fetch ─────┼──► fetch('./questions.json')  同源靜態檔     │
│                    └──► fetch(AI_PROXY_URL)        跨源 POST      │
└────────────────────┼────────────────────────────────────────────┘
                     │
      ┌──────────────┴───────────────┐
      │                              │
      ▼                              ▼
┌──────────────────┐      ┌──────────────────────────────────────┐
│ GitHub Pages     │      │ Vercel Serverless  api/questions.js   │
│ （靜態託管）       │      │                                      │
│ index.html       │      │  ① origin allowlist ──► 403           │
│ css/ js/ assets/ │      │  ② method 檢查      ──► 405           │
│ questions.json   │      │  ③ difficulty enum  ──► 400           │
│                  │      │  ④ 記憶體滑動視窗限流 ──► 429           │
│ ★ 只在 deploy.yml │      │  ⑤ GEMINI_API_KEY 存在? ──► 503       │
│   跑過才會更新     │      │  ⑥ callGemini ──► isValidQuestions   │
└──────────────────┘      │                 ──► 502 / 200         │
                          └──────────────┬───────────────────────┘
                                         │ x-goog-api-key
                                         ▼
                          ┌──────────────────────────────┐
                          │ Google Gemini API            │
                          │ gemini-2.5-flash             │
                          └──────────────────────────────┘

┌─── 離線 / 排程側 ─────────────────────────────────────────────┐
│ GitHub Actions 每週日 UTC 19:00                              │
│   pip install google-generativeai  ★ 已終止支援               │
│   → generate_questions.py → Gemini → 驗證 → 合併 → 去重       │
│   → git commit + push（GITHUB_TOKEN）                        │
│   ✗✗✗ GITHUB_TOKEN 的 push 不會觸發任何 workflow ✗✗✗          │
│   → deploy.yml 不跑 → GitHub Pages 上的 questions.json 沒變    │
└──────────────────────────────────────────────────────────────┘
```

### 各層狀態

| 層 | 使用技術 | 狀態評價 |
|---|---|---|
| **Framework** | **目前不存在**（Vanilla JS ES modules） | ✅ 合理。專案規模（~950 行 JS）根本不需要框架，零 build step 是資產 |
| **Runtime** | 瀏覽器原生 ESM；Node 22（測試）；Vercel Node（API）；Python 3.11（腳本） | ✅ 合理 |
| **Language** | JavaScript（無 TypeScript）、Python 3 | ⚠️ 無型別。目前靠 `isValid*` runtime 驗證補，規模小尚可接受 |
| **Routing** | **目前不存在**。單頁三狀態，靠 `render()` 依 `_data` 分支 | ✅ 合理。無 URL 狀態，但也代表無法深連結、無法上一頁 |
| **State management** | **目前不存在**（`js/app.js` 的三個模組級 `let`） | ⚠️ Prototype 寫法。`_data` / `_hist` 是可變全域，記憶體與 localStorage 可能不同步（P1-2 的根因） |
| **Data fetching** | 原生 `fetch`。`questions.json` 用 `cache: 'no-store'`；AI 有 AbortController 8s timeout + inflight dedup | ✅ 合理，甚至細緻 |
| **API architecture** | 單一 POST endpoint，request body 只有 `{ difficulty }` | ✅ 合理。攻擊面極小 |
| **Auth** | **目前不存在**。無登入、無帳號、無 session | ✅ 對此產品是刻意且正確的選擇（零摩擦是核心價值） |
| **Database** | **目前不存在**。唯一持久層是瀏覽器 localStorage | ⚠️ 直接後果：換裝置／清快取 = 紀錄全失。對「連續達標天數」這個核心指標是致命的 |
| **Storage** | localStorage（`brain-game:` 命名空間）+ Git（`questions.json`） | ⚠️ 見上 |
| **AI / LLM** | Gemini `gemini-2.5-flash`：① 線上即時出題（proxy）② 每週題庫擴充（Python） | ⚠️ 兩條路徑用兩套 SDK／兩份 prompt／兩份驗證器，已開始漂移 |
| **Analytics** | GA4（`js/analytics.js`），5 個事件：start_game / answer_question / complete_game / retry_game / share_result | ✅ 事件設計合理　⚠️ 線上是否啟用未知 |
| **Logging** | 後端：結構化 JSON 到 Vercel stdout。前端：`logError` 到瀏覽器 console | ⚠️ 前端 log 沒有任何收集端——寫了等於沒人看得到 |
| **Error handling** | 三層降級鏈（AI → questions.json → 內建 fallback），全路徑實測有效 | ✅ 這是全專案最好的設計 |
| **Monitoring** | **目前不存在**。無告警、無 uptime check、無 error tracking | ❌ CLAUDE.md §6 整章未實作 |
| **Testing** | Node 原生 test runner（78）+ Python unittest（42）。無 DOM／E2E | ⚠️ 缺口正好落在缺陷發生的地方 |
| **Deployment** | 前端 GitHub Pages（Actions artifact 路徑）；後端 Vercel（Git 整合，repo 內無 `vercel.json`） | ❌ **交付管線有斷點**（P0-1） |
| **Environment management** | GitHub Secrets（`GEMINI_API_KEY`、`GA_MEASUREMENT_ID`、`ANTHROPIC_API_KEY`、`SLACK_WEBHOOK_URL`）+ Repo Variables（`AI_PROXY_URL`）+ Vercel env vars | ⚠️ 沒有 local/staging，只有 production。設定散在三個外部系統，repo 內無單一清單 |

### 架構判定

**合理、應該保留的：**
- 純函式層（`js/logic.js`）與副作用層（`storage`/`ai`/`render`）的分離——這讓 78 個測試能在 Node 裡跑，不需要 jsdom。
- 三層降級鏈。這是產品韌性的來源，實測每一層都真的會接手。
- `isValidQuestions` 從 `js/logic.js` 單一來源 export 給 `api/questions.js` 共用——消除了驗證邏輯漂移。
- proxy 的驗證順序（origin → method → enum → 限流 → key → Gemini）——昂貴的操作永遠排在最後。

**只是 prototype 寫法：**
- `js/app.js` 的模組級可變狀態。沒有單一 commit point，`_data` 可以被任意路徑改了卻不落地。
- `api/questions.js` 的 `Map` 限流。程式碼註解自己就寫明了「單實例、盡力而為」——誠實，但這代表限流對分散式攻擊無效。

**已是技術債：**
- 兩套 Gemini 整合（Node `fetch` vs Python SDK）、兩份 prompt、兩份驗證器（JS `isValidQuestion` vs Python `validate_questions`）。規則已經開始各寫各的。
- 前端 `logError` 無收集端。

**會阻礙下一階段：**
- **無後端持久層**：只要想做「換手機還在」「家人可以看爸媽的紀錄」「排行榜」任何一個，就必須先有帳號與資料庫。這是產品下一階段的天花板。
- **無 E2E 測試**：P1-2 這類狀態轉換缺陷，現有 120 個測試結構上抓不到。

---

## Pages & Routes

本專案是**單頁、無路由**（`目前不存在` router）。以下是實際的「視圖」清單。

| 視圖 | 進入條件 | 產生者 | 狀態 |
|---|---|---|---|
| 步數頁 | `!completed && steps == null` | `render/step.js:buildStepHtml` | ✅ COMPLETE |
| Loading 頁 | `aiEnabled()` 且正在取 AI 題 | `render/loading.js:renderLoading` | ✅ COMPLETE（AI 關閉時永不出現） |
| 答題頁 | `!completed && steps != null` | `render/question.js:buildQuestionHtml` | ✅ COMPLETE |
| 完成頁 | `completed === true` | `render/complete.js:buildCompleteHtml` | ⚠️ PARTIAL（返回路徑缺陷） |

### Modal / 對話框

| 元件 | 實作 | 評價 |
|---|---|---|
| 無效步數提示 | 原生 `alert()` | ⚠️ 對長者 UX 不佳（不可讀屏友善、無法樣式化、跳出焦點）。應改為 `#db` 區域的 inline 錯誤訊息 |
| 重新挑戰確認 | 原生 `confirm()` | ⚠️ 同上，但破壞性操作需要確認是對的 |
| 複製失敗退路 | 原生 `prompt('長按複製：', txt)` | ✅ 對舊瀏覽器的務實退路 |

### Navigation

| 元素 | 位置 | 狀態 |
|---|---|---|
| 全域導航列 | **不存在** | 對三狀態單頁是合理的 |
| 字體大小切換 | header（全域常駐） | ✅ COMPLETE（`aria-pressed` 正確） |
| 「← 返回主頁」 | 完成頁 | ⚠️ PARTIAL（見 P1-2） |
| 頁尾贊助連結 | footer（全域常駐） | ✅ COMPLETE |

### Shared Components

| 元件 | 位置 | 被誰用 |
|---|---|---|
| `escapeHtml` | `render/helpers.js` | question.js（★ XSS 唯一防線） |
| `statRowHtml` | `render/helpers.js` | step.js, complete.js |
| `historyRowsHtml` | `render/helpers.js` | step.js, complete.js |
| `sourceBannerHtml` / `qSourceTagClass` / `qSourceLabel` | `render/helpers.js` | question.js, complete.js |

### UI 狀態逐項檢查

| 狀態 | 實作 | 實測 | 判定 |
|---|---|---|---|
| **首頁** | 步數頁（新用戶無統計列，老用戶有） | ✅ | COMPLETE |
| **核心任務流程** | 步數 → 答題 → 完成 | ✅ | COMPLETE |
| **Loading** | AI 出題時的 spinner + 1.5s 輪播文案 | 程式碼確認（AI 未啟用無法實測） | COMPLETE |
| **Empty state** | 新用戶隱藏統計列與歷史卡；完成頁顯示「尚無記錄」 | ✅ | COMPLETE |
| **Error state** | AI 失敗／404 靜默降級，**使用者完全看不到錯誤** | ✅ | ⚠️ 刻意設計，對長者是對的；但代價是 AI 壞掉時沒人會回報 |
| **Mobile** | 390×844 單欄，觸控目標 ≥48px | ✅ | COMPLETE |
| **Responsive** | 600px / 900px 兩斷點，桌機選項雙欄 | ✅ 實測 grid 400.7px×2、無水平溢出 | COMPLETE |
| **Disabled state** | 已答題的選項 `disabled` + `.done` 降透明度 | ✅ | COMPLETE |
| **Success state** | 成果卡（漸層、emoji、統計、streak、紅綠點） | ✅ | COMPLETE |
| **Back / cancel flow** | `#backBtn` 返回、`confirm` 取消重試 | ❌ 返回路徑造成重複計分 | **BROKEN** |
| **重整後狀態** | localStorage 還原至正確階段 | ✅ 含「答一題後重整」 | COMPLETE |
| **Edge case** | 空白／負數／超過 99999 步 | ✅ 皆正確攔截 | COMPLETE |

### 分類結果

- **已完成**：步數頁、答題頁、Loading、字體控制、降級鏈、響應式、重整續存、邊界輸入。
- **部分完成**：完成頁（返回路徑）。
- **無入口**：`assets/og-image.svg`（無引用）。
- **有畫面但無功能**：無。
- **有功能但 UX 不完整**：`alert()`／`confirm()` 對銀髮族不友善；AI 失敗完全靜默（使用者無感 = 也無從回報）。
- **Broken flow**：完成 → 返回主頁 → 重玩。

---

## Data Flow

```
Source ──────────► Fetch ──────────► Transform ──────► State ──────► UI ──────► Mutation ──────► Persistence
```

### 題目資料

| 階段 | 實作 |
|---|---|
| **Source** | ① Gemini API（即時，經 proxy）② `questions.json`（1200 題，同源靜態）③ `js/fallback-questions.js`（120 題，打包在 JS 內） |
| **Fetch** | ① `js/ai.js:fetchFromProxy`（8s timeout、inflight dedup、每日快取）② `js/app.js:fetchQuestionBank`（`cache:'no-store'`）③ 無需 fetch |
| **Transform** | ① `isValidQuestions` → `slice(0,3)` → `shuffleOptions` ② `isValidQuestionBank` → `pickQuestions`（fresh-first + 題型多樣性 + 打亂選項） |
| **State** | `js/app.js` 的 `QB`（題池）與 `_data.questions`（今日 3 題） |
| **UI** | `render/question.js` — **所有 AI 來源字串（`q.q`/`q.a`/`q.opts[*]`）皆經 `escapeHtml`** ✅ |
| **Mutation** | 使用者點選項 → `_data.answers[i] = b.dataset.o` |
| **Persistence** | `localStorage['brain-game:today:YYYY-MM-DD']`（每次作答即存） |

### 歷史統計資料

| 階段 | 實作 |
|---|---|
| **Source** | 只有 localStorage。**無伺服器端資料。** |
| **State** | `js/app.js` 的 `_hist` |
| **Mutation** | `applyDailyResult`（完成時）／`revertDailyResult`（重試時）。兩者皆回傳新物件、不改原物件 ✅ |
| **Persistence** | `localStorage['brain-game:history']`，log 上限 `MAX_HISTORY_LOG = 30` |

### 特別排查項

| 項目 | 發現 |
|---|---|
| **Duplicate state** | ⚠️ **有**。`_data.aiGenerated` 與 `ai-flag:ai-cache:{today}:{diff}:v{n}` 兩處記錄同一事實，靠 `syncAiGeneratedFlag()` 手動對齊。 |
| **Stale state** | ❌ **有，且是缺陷根源**。`#backBtn` 把記憶體的 `_data.completed` 改成 `false` 卻**不呼叫 `saveTodayData`**，localStorage 仍是 `true`。記憶體與儲存體從此不一致。 |
| **localStorage** | 全部資料唯一的家。7 種 key：`today:*`、`history`、`recent:{diff}`、`font-scale`、`ai-retry:{today}`、`ai-cache:*`、`ai-flag:*`。**無過期清理**——`today:*`、`ai-cache:*`、`ai-flag:*` 每天都新增一組且永不刪除，長期使用者的 localStorage 會單調成長。 |
| **Mock data** | 無。`tests/` 內的 `makeQuestion()`／`stubFetch()` 只在測試檔內。 |
| **Hard-coded data** | `js/fallback-questions.js` 的 120 題是刻意內嵌的離線保底，不是暫時資料。 |
| **Temporary data** | 無。 |
| **API fallback** | ✅ 三層，實測有效。 |
| **Optimistic update** | 無（作答即時渲染屬同步本地運算，非 optimistic）。 |
| **Cache** | ① AI 每日快取（含 retry 版號，重試時 bump 版號取得新題）② `questions.json` 明確 `no-store` ③ 近期出題記錄（每難度 60 題）。設計完整。 |
| **Refresh 後是否遺失** | ✅ 不遺失。實測含「答到一半重整」。**但**換裝置／換瀏覽器／清快取 = 全部歸零，且使用者完全無法備份或還原。 |
| **多頁面狀態一致性** | 不適用（單頁）。**但同一裝置開兩個分頁會互相覆寫**——兩個分頁各持有自己的 `_data`／`_hist`，後寫的贏。低機率但真實存在。 |

### ⚠️ 這不是 prototype mock flow

題目資料**是真的**：`questions.json` 由真實 Gemini 呼叫產生並經驗證，內建 fallback 是人工種題。
歷史統計**也是真的**使用者資料——只是**只存在使用者自己的瀏覽器裡，沒有任何後端**。
請勿把「有 `api/questions.js`」誤解為「有後端資料庫」：**那是一個無狀態的 AI 代理，不存任何使用者資料。**

---

## Functional Coverage Matrix

| 功能 / Flow | 狀態 | 完成度 | 問題 | 建議 |
|---|---|---|---|---|
| 步數 → 難度判定 | COMPLETE | 100% | 無 | 維持 |
| 每日 3 題答題流程 | COMPLETE | 100% | 無 | 維持 |
| 計分與即時對錯回饋 | COMPLETE | 100% | 無 | 維持 |
| 連續達標天數（streak） | PARTIAL | 80% | 返回主頁重玩會重複累計；`累積天數` 實為 log 筆數非相異天數 | 修 P1-2；`log.length` 改為相異日期計數 |
| 歷史記錄（最近 5 筆） | PARTIAL | 85% | 同日可出現多筆 | 隨 P1-2 一併修 |
| 靜態題庫（1200 題） | COMPLETE | 100% | 已達 300/難度 上限 | 見下列 |
| 題庫每週自動擴充 | **BROKEN** | 40% | **產生成功但從未部署到線上**；13 次排程 3 次全失敗；SDK 已終止支援 | **P0-1 / P1-3** |
| 題庫品質（難度校準） | PARTIAL | 55% | 只驗結構不驗語意：`hard` 內有「10 隻兩張嘴的青蛙有幾張嘴」這種 super_easy 級題目 | 加難度抽樣審查或分級 heuristic |
| 內建 fallback 題庫 | COMPLETE | 100% | 無 | 維持 |
| 近期出題排除（60 題/難度） | COMPLETE | 100% | 無 | 維持 |
| AI 即時出題（前端） | UNKNOWN | 90%（程式碼） | 程式碼與測試完備，但**線上 `AI_PROXY_URL` 是否設定無人能確認** | 先確認線上開關狀態 |
| AI proxy（後端） | COMPLETE | 95% | 限流僅單實例；無 `vercel.json` | 上量前改 KV/Redis |
| 出題來源標籤（AI/題庫） | COMPLETE | 100% | AI 關閉時永遠顯示題庫 | 維持 |
| 分享文字複製 | COMPLETE | 100% | 無 clipboard API 時退 `prompt` | 維持 |
| 重新挑戰 | COMPLETE | 100% | 正確 revert，是唯一做對的重玩路徑 | 以此為 P1-2 的修法範本 |
| 返回主頁 | **BROKEN** | 30% | 不落地 `completed=false`，開啟重複計分路徑 | **P1-2** |
| 字體大小切換 | COMPLETE | 100% | 無 | 維持 |
| 響應式版面 | COMPLETE | 100% | 實測無水平溢出 | 維持 |
| 無障礙（ARIA / focus / reduced-motion） | PARTIAL | 85% | `alert()`／`confirm()` 非讀屏友善；無 skip link | 換成 inline 錯誤訊息 |
| GA4 事件追蹤 | UNKNOWN | 90%（程式碼） | 5 個事件設計完整，**線上是否啟用未知** | 確認 `GA_MEASUREMENT_ID` |
| 贊助連結 | COMPLETE | 100% | 無 | 維持 |
| SEO / OG meta | COMPLETE | 100% | 無 | 維持 |
| 跨裝置同步 | MISSING | 0% | 無帳號、無後端資料庫 | 下一階段的產品決策 |
| 資料備份 / 匯出 | MISSING | 0% | 清快取即全失，使用者無從自救 | Phase 1 低成本補（匯出 JSON） |
| 異常偵測 / 自動開 issue | MISSING | 0% | CLAUDE.md §6 整章未實作 | Phase 2 |
| 前端錯誤收集 | MISSING | 0% | `logError` 只寫到瀏覽器 console，無人看得到 | Phase 2 |

### 完成度估算

| 面向 | 估算 | 依據 |
|---|---|---|
| **產品完成度** | **70%** | 核心迴圈 100% 可用且實測通過，但招牌的「每週更新」在使用者端實質失效、AI 差異化路徑線上狀態不明、跨裝置與備份為 0 |
| **UI / UX** | **80%** | 12 項 UI 狀態檢查 10 項 COMPLETE；扣分在 back flow BROKEN、`alert/confirm` 對銀髮族不友善、錯誤完全靜默 |
| **Frontend** | **85%** | 模組化乾淨、無 dead code、無 TODO、三層降級實測有效、a11y 真的做了；扣分在模組級可變狀態導致的記憶體/儲存不同步 |
| **Backend** | **75%** | proxy 四道防線齊備、32 個測試、全路徑結構化 log；扣分在單實例限流、無 `vercel.json`、部署狀態無法驗證、無任何 runtime 觀測 |
| **Integration** | **55%** | 前端↔proxy 有 mock 層級測試但**從未端到端驗證過**；CI↔Pages 這條整合**實際是斷的**（8 次題庫更新零次送達）；Vercel↔repo 無設定檔可查 |
| **Testing** | **70%** | 120 個測試、6 個檔案、涵蓋純函式/proxy handler/限流/AI 模組/XSS/5 個 user profile；扣分在**零 DOM 測試、零 E2E**——而唯一的功能缺陷正好落在這個缺口 |
| **Production readiness** | **45%** | 有 CI、有測試、有 PR review 自動化、有降級韌性；但無監控、無告警、無 error tracking、排程失敗 3 次無人知曉、部署未驗證、CLAUDE.md §6 整章空白 |

---

## Build / Lint / Typecheck / Test Status

| # | 項目 | 指令 | 結果 | 說明 | 阻塞產品? |
|---|---|---|---|---|---|
| 1 | **Install** | （無） | **NOT AVAILABLE** | `package.json` 無 dependencies／devDependencies，無 lockfile，無 `node_modules`。**這是刻意的零依賴設計，不是缺陷。** | 否 |
| 2 | **Build** | （無） | **NOT AVAILABLE** | 純靜態站，無 build step。`index.html` 直接 `<script type="module">`。 | 否 |
| 3 | **Lint** | （無） | **NOT AVAILABLE** | repo 內無 ESLint／Prettier／ruff／flake8 設定（`AGENTS.md` 也明說）。替代方案：`node --check <file>`。 | 否（但見 P2） |
| 4 | **Typecheck** | （無） | **NOT AVAILABLE** | 無 TypeScript、無 JSDoc types、無 mypy。型別安全靠 runtime 的 `isValid*` 驗證。 | 否 |
| 5 | **Test (JS)** | `npm test` | ✅ **PASS** | `tests 78 / pass 78 / fail 0`，858ms。含 `--test-concurrency=1`（避免 proxy 測試改 env 互相干擾）。 | — |
| 6 | **Test (Python)** | `python3 -m unittest test_generate_questions -v` | ✅ **PASS** | `Ran 42 tests / OK`，26ms。 | — |
| 7 | **Dev server** | `python3 -m http.server 8000` | ✅ **PASS** | 實際啟動於 :8123 並完整跑過主流程。 | — |
| 8 | **questions.json schema 驗證** | CI 內嵌 node script | ✅ **PASS** | 1200 題全數通過 `isValidQuestionBank`；額外自查：各難度 300 題、題文零重複、跨難度零重複。 | — |
| 9 | **`python` 指令存在** | `which python` | ✅ **PASS** | 本環境有 symlink。⚠️ `AGENTS.md` 已警告乾淨環境可能只有 `python3`。 | 否 |

### 實際跑過的主要 User Flow（Chromium headless + Playwright 1.56.1）

15 項檢查，**14 PASS / 1 FAIL**。完整輸出見 [User Flow](#user-flow) 章節。

| 檢查面向 | 結果 |
|---|---|
| **Browser console** | 乾淨。唯一錯誤是 `fonts.googleapis.com` 被本沙箱 egress proxy 擋掉（`ERR_CONNECTION_RESET`）——**環境限制，非產品缺陷**；頁面正確降級為系統 serif。 |
| **Runtime error** | 零 `pageerror`。 |
| **Network error** | 除 Google Fonts 外，零失敗請求。 |
| **Failed request** | 刻意注入 `questions.json` 404 → 正確降級到內建 fallback，遊戲照常可玩。 |
| **Broken route** | 不適用（單頁無路由）。 |
| **Hydration issue** | 不適用（無 SSR）。 |
| **明顯 UI bug** | **找到 1 個**：完成 → 返回主頁 → 重玩 → 重複計分（見 P1-2，附完整重現）。 |

> **留下的紀錄（依第十三條「極小修改須留紀錄」）**：本輪**未修改任何產品程式碼**。
> 唯一新增檔案為本報告 `PROJECT_AUDIT.md`。實測用的 Playwright 腳本寫在 session scratchpad
> （`/tmp/.../scratchpad/smoke.mjs`、`bug.mjs`），**未進入 repository**。
> `git status` 於盤點開始時為 clean，未執行任何 reset／force push／檔案刪除。

---

## Dependency & Environment Status

### Dependencies

| 類別 | 內容 |
|---|---|
| **npm dependencies** | **零**。 |
| **npm devDependencies** | **零**。測試用 Node 22 內建 `node:test` + `node:assert`。 |
| **Lockfile** | **不存在**。因為沒有依賴，所以不需要——**這是合理的，不是遺漏**。 |
| **Python dependencies** | `generate_questions.py` 僅用標準庫（`json`/`os`/`sys`/`unicodedata`），**但 `call_gemini()` 內 `import google.generativeai`**，由 workflow 的 `pip install google-generativeai` 提供（未鎖版本）。 |
| **前端 CDN 依賴** | Google Fonts（`Noto Serif TC`、`Fraunces`），CSS `@import`。 |

### 真正影響穩定／安全／擴充的問題（只列這些）

| 問題 | 嚴重度 | 依據 |
|---|---|---|
| **`google-generativeai` 已終止支援** | **P1** | Actions log 原文：`All support for the google.generativeai package has ended. It will no longer be receiving updates or bug fixes. Please switch to the google.genai package as soon as possible.` 這是題庫更新的**唯一** SDK，停止運作那天題庫就永久凍結。 |
| **`pip install google-generativeai` 未鎖版本** | **P2** | 每週排程都抓最新版。上游任何 breaking change 都會在某個週日凌晨無聲炸掉。 |
| **Google Fonts 用 CSS `@import`** | **P3** | `@import` 會阻塞 CSSOM，且 `font-family` 的退路只到泛型 `serif`。對台灣長輩的低速連線有實際影響。改 `<link rel="preconnect">` + `<link>` 即可。 |
| 無 linter | **P2** | 見 Technical Debt。 |
| 無 outdated / unused / duplicate 套件 | — | **因為沒有套件**。零供應鏈風險是這個專案的實質資產。 |
| 無 version conflict | — | 同上。 |

### Environment Variables（散落三個系統，repo 內無單一清單）

| 變數 | 存放位置 | 必填 | 用途 | 風險 |
|---|---|---|---|---|
| `GEMINI_API_KEY` | Vercel env + GitHub Secrets（**兩份**） | 必填 | Gemini 呼叫 | ⚠️ 同一把 key 存兩處，輪替時容易漏掉一邊 |
| `ALLOWED_ORIGINS` | Vercel env | 選填 | origin allowlist | 預設 `https://lwc1129.github.io` |
| `RATE_LIMIT_MAX` | Vercel env | 選填 | 限流上限（預設 30） | CLAUDE.md 標為 scaling lever |
| `RATE_LIMIT_WINDOW_MS` | Vercel env | 選填 | 限流視窗（預設 60000） | — |
| `AI_PROXY_URL` | GitHub **Variable** | 選填 | deploy 時 sed 注入 `js/config.js` | ⚠️ **是否已設定無法從 repo 判斷** → AI 功能開關狀態不明 |
| `GA_MEASUREMENT_ID` | GitHub **Secret** | 選填 | deploy 時注入 | ⚠️ 同上 |
| `ANTHROPIC_API_KEY` | GitHub Secrets | 選填 | PR review workflow | — |
| `SLACK_WEBHOOK_URL` | GitHub Secrets | 選填 | PR review 通知 | — |

### Secrets 風險評估

✅ **無洩漏**。已逐檔確認：
- `js/config.js` 提交值為兩個空字串，註解明寫「原始碼中一律留空，不得放任何金鑰」。
- `deploy.yml` 只注入 `AI_PROXY_URL`（可公開的網址）與 `GA_MEASUREMENT_ID`（本來就會出現在前端），
  並有 `# 注意：絕不把 GEMINI_API_KEY 注入前端` 的明確註解。
- `GEMINI_API_KEY` 只出現在 `api/questions.js`（`process.env`）與 `generate_questions.py`（`os.environ`）。
- `git log -p` 範圍內未見 key 字面值。
- `ai-pr-review.yml` 把 PR diff 經 **env 傳遞而非 `${{ }}` 內插**，已避免 script injection——這點做得比多數專案好。

### local / staging / production 差異

| 環境 | 狀態 |
|---|---|
| **local** | 僅前端（`python3 -m http.server`）。`AI_PROXY_URL` 為空 → 自動走題庫，遊戲完整可玩。**無法在本地測 AI 路徑。** |
| **staging** | **目前不存在。** 沒有預覽環境、沒有 staging Pages、Vercel preview deployment 無人使用。任何變更 merge 即上線。 |
| **production** | GitHub Pages + Vercel。**有一個斷點**（P0-1）。 |

### Build / Deployment Config

| 檔案 | 狀態 |
|---|---|
| `deploy.yml` | ✅ 正確。`concurrency: pages` + `cancel-in-progress` 避免併發部署。`set -euo pipefail` + `grep -q` 驗證注入成功——寫得很嚴謹。 |
| `test.yml` | ⚠️ 缺 CLAUDE.md §4 要求的獨立 `integration-tests` job（實際由 `npm test` 的 glob 涵蓋，結果等價）。 |
| `update_questions.yml` | ❌ **有 P0-1 斷點**。且 `pip install` 未鎖版、失敗後無任何通知。 |
| `ai-pr-review.yml` | ✅ 可用。⚠️ diff 硬截斷 150 行——大 PR 的 review 品質會大幅下降。 |
| `vercel.json` | ❌ **不存在**。後端部署設定完全在 Vercel 控制台，repo 內無任何紀錄，無法 code review、無法重建。 |
| `.nojekyll` | ✅ 存在。 |

---

## Technical Debt

> 只列真正有影響的項目。「可以改善但無實質影響」的一律不列。

### 🔴 P0 — 產品無法正常使用 / 嚴重資料或安全問題

#### P0-1　每週自動更新的題庫從未送達線上使用者

**這是本次盤點最重要的發現。**

`update_questions.yml` 用 `GITHUB_TOKEN` 執行 `git push`。
GitHub 明訂：**以 `GITHUB_TOKEN` 推送的 commit 不會觸發任何 workflow**（防遞迴機制）。
而 `deploy.yml` 的觸發條件只有 `push: branches: [main]`，且 GitHub Pages 走的是
`upload-pages-artifact` + `deploy-pages` 路徑——**不跑 deploy.yml，線上檔案就一個位元組都不會變**。

**證據（GitHub Actions 執行歷史）：**

| Workflow | 執行 #37 | 執行 #38 | 中間發生什麼 |
|---|---|---|---|
| Deploy to GitHub Pages | 2026-07-10 | **2026-09-09** | **整整 61 天零部署** |
| Tests | 2026-07-10（push） | 2026-09-09 | 同樣未在題庫 commit 上執行 |

同期間進入 `main` 的題庫 commit：
`07-12`、`07-19`、`07-26`、`08-02`、`08-16`、`08-23`、`08-30`、`09-06` —— **共 8 次，零次送達線上。**
（2026-09-09 是人類 merge PR #30/#31，才順帶把積壓 2 個月的題庫一次推上線。）

**影響：**
1. 「每週自動更新題庫」這個寫在 README、寫在 UI 文案（「每週自動更新，近期出過的題目不重複」）
   的產品主張，**在使用者端不成立**。老玩家實際感受到的重複率遠高於設計預期。
2. `test.yml` 同樣不會在這些 commit 上執行 → **`questions.json` 的前端 schema 驗證，
   對每一批自動產生的題目從來沒有跑過**。目前僥倖沒出事，是因為 Python 端的
   `validate_questions` 規則恰好等價；只要兩邊哪天漂移，壞掉的題庫會直接進 main 且無人察覺。
3. 這使得任何「改善題庫品質」的工作在修好之前**都無法送到使用者面前**。

**修法（三選一，建議第一個）：**
```yaml
# deploy.yml
on:
  push:
    branches: [main]
  workflow_run:
    workflows: ["每週自動更新題庫"]
    types: [completed]
  workflow_dispatch:

jobs:
  deploy:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
```
其他選項：② `update_questions.yml` 末尾用 `gh workflow run deploy.yml` 明確觸發；
③ 改用 PAT 推送（**不建議**——等於為了繞過安全機制而放寬權限）。

---

### 🟠 P1 — 近期一定要處理，會阻礙開發或核心流程

#### P1-2　「返回主頁」路徑造成重複計分與同日重複記錄

**已在 Chromium 完整重現：**
```
完成一次後 history: {"total":20,"streak":1,"lastDate":"2026-09-11",
                     "log":[{"date":"2026-09-11","steps":5000,"correct":2,"score":20}]}
返回主頁後 localStorage.completed = true   ← 記憶體已改 false，未落地
第二次完成後 history: {"total":30,"streak":1,"lastDate":"2026-09-11",
                     "log":[{"date":"2026-09-11",...,"score":20},
                            {"date":"2026-09-11",...,"score":10}]}   ← 同一天 2 筆
畫面顯示：30 累積分數 / 🔥1 連續達標天 / 2 累積天數      ← 一天卻算 2 天
```

**根因**（`js/app.js:229-232`）：
```js
() => {
  _data.completed = false;   // ← 只改記憶體
  renderStep();              // ← 沒有 saveTodayData，也沒有 revertDailyResult
},
```
對照同一函式裡**寫對了的**重試路徑（`js/app.js:233-243`）：它先 `revertDailyResult` 扣回分數、
`bumpAiRetryVersion`、`clearInflight`、重置 `_data`、**兩個 save 都呼叫**。
返回路徑少做了全部這些事。

**兩個獨立的錯誤後果：**
1. **記憶體 / 儲存不一致**：記憶體 `completed=false`，localStorage `completed=true`。
   此時重整頁面會「跳回」完成頁——使用者會覺得「我明明按了返回」。
2. **重複計分**：`applyDailyResult` 每次呼叫都 `next.log.push(...)` 且 `next.total += score`，
   完全不檢查當天是否已有記錄。走返回路徑重玩，同一天就被算兩次。
   `累積天數`（`hist.log.length`）也因此不再是「天數」。

**建議修法：** `#backBtn` 的 handler 與 `#retryBtn` 共用同一條「撤銷當日結果」的路徑
（`revertDailyResult` + 兩個 save），或在 `applyDailyResult` 內加上「同日冪等」保護
（偵測 `log` 已有 `today` 則先移除舊筆再 push）。後者更穩健，因為它同時擋掉未來所有
可能繞過的路徑。**務必同時補一個 integration test**——這正是現有 120 個測試抓不到的類型。

#### P1-3　題庫生成依賴已終止支援的 SDK，且失敗完全無人知曉

三個疊加的問題：

1. **SDK 已終止支援**：Actions log 明確輸出
   `All support for the google.generativeai package has ended.`
   `pip install google-generativeai` 還未鎖版本——上游哪天下架或改行為，排程就無聲死亡。
2. **失敗率 23%**：13 次排程中 **3 次完全失敗**（2026-06-21、06-28、08-09）。
   08-09 的失敗原因是 `難度 hard 第 2 題的正確答案 a 不在 opts 選項中`——
   **Gemini 回傳的 30 幾題裡只要有 1 題格式不對，`validate_questions` 就讓整批全滅**，
   沒有「丟掉壞題、留下好題」的部分接受機制。
3. **無人知曉**：失敗只留在 Actions 頁面。沒有 Slack 通知（`ai-pr-review.yml` 明明已經有
   `SLACK_WEBHOOK_URL` 的成功範例可抄）、沒有自動開 issue（CLAUDE.md §6 要求但未實作）。

**建議：** ① 遷移到 `google-genai` 並鎖 major 版本；② `validate_questions` 拆成
「逐題過濾」+「整體驗證」，讓單一壞題不再讓整批全滅；③ 排程失敗時發 Slack 或開 issue。

#### P1-4　題庫難度校準只驗結構、不驗語意，且人工種題正在被無審查的 AI 題逐週替換

`questions.json` **四個難度都已滿 300 題**（達 `MAX_PER_DIFFICULTY` 上限）。
`merge_question_banks` 的 `combined[-MAX_PER_DIFFICULTY:]` 代表：
**每週新增幾題，就從最前面（最舊、也就是人工種的）淘汰幾題。**
近 5 次排程每次汰換 ~30 題。照此速率，`seed_questions.py` 產出的 1200 題人工題庫
會在約 40 週內被完全替換成**沒有經過任何人審閱的 AI 輸出**。

而驗證只看結構（型別、4 個選項、答案在選項中、選項互異），**完全不看語意與難度**。
盤點時從 `hard` 的最新題目中實際撈到：

| 難度 | 題目 | 問題 |
|---|---|---|
| `hard` | 「如果一隻青蛙有兩張嘴，那麼十隻青蛙會有幾張嘴？」 | 這是 `super_easy` 級的題目，卻標在「困難」 |
| `hard` | 「小明比小華高，小華比小美高，誰最高？」 | 同上 |
| `super_easy` | 「找出數列的下一個數字：2, 2, 2, 2, ?」 | 退化題，無認知訓練價值 |

**為什麼這是 P1 而不是 P2：** 步數 ↔ 難度的耦合是**這個產品唯一的原創機制**。
如果走 1000 步拿到的「困難」題和走 8000 步拿到的「超簡單」題一樣簡單，核心機制就失效了，
產品退化成「隨機腦力測驗網站」。這條技術債直接侵蝕產品的差異化。

---

### 🟡 P2 — 可以排入後續改善

| # | 項目 | 說明 |
|---|---|---|
| P2-1 | **完全沒有 linter／formatter** | 無 ESLint、無 Prettier、無 ruff。`AGENTS.md` 自己也說「若要快速語法檢查，可用 `node --check`」。目前程式風格一致是靠 AI review 與人工，不是靠工具。零依賴原則可用 `node --check` + CI 的輕量檢查達成，不必引入完整工具鏈。 |
| P2-2 | **零 DOM／E2E 測試** | 120 個測試全部是純函式與 mock 層級。`js/app.js`（258 行、全部狀態轉換）、`js/render/*`（255 行）**沒有任何一行被測試執行過**。P1-2 正是落在這個缺口。 |
| P2-3 | **localStorage 單調成長，無過期清理** | 每天新增 `today:{date}`、`ai-cache:{date}:{diff}:v{n}`、`ai-flag:*`，**永不刪除**。玩一年 = 數百個 key。雖離 5MB 上限尚遠，但 `history` 有 `MAX_HISTORY_LOG=30` 上限而其他 key 沒有，是不一致的設計。 |
| P2-4 | **前端 `logError` 沒有收集端** | 寫進瀏覽器 console 就結束了。`js/ai.js`、`js/storage.js`、`js/app.js` 的錯誤路徑都有 log，但**沒有任何人看得到**。CLAUDE.md §2 要求「不用讀程式碼也能從 log 診斷」——後端做到了，前端沒有。 |
| P2-5 | **限流僅單 Vercel 實例** | 程式碼註解已誠實說明。目前流量下無感，但它是 Gemini 配額的唯一防線，且**只在熱實例上有效**。CLAUDE.md §6 已把 `RATE_LIMIT_MAX` 標為 scaling lever。 |
| P2-6 | **`vercel.json` 不存在** | 後端部署設定（runtime、region、function config）完全只在 Vercel 控制台。無法 code review、無法從 repo 重建、換人接手就是黑箱。 |
| P2-7 | **無 staging / preview 環境** | merge 即上線，沒有任何中間驗證點。 |
| P2-8 | **兩套 Gemini 整合已開始漂移** | Node `fetch`（proxy，`buildPrompt` + `pickPromptTypes` 隨機題型）vs Python SDK（排程，`build_prompt` + `compute_type_counts` 補弱勢題型）。兩份 prompt、兩份驗證器（JS `isValidQuestion` / Python `validate_questions`）。前端與 proxy 已經共用了 `isValidQuestions`，Python 這條沒有。 |
| P2-9 | **`alert()` / `confirm()` 對銀髮族不友善** | 目標客群是長者，卻用系統原生對話框：無法放大字體、非讀屏友善、會奪走焦點。`#db` 區域已有 `aria-live="polite"`，改成 inline 錯誤訊息是低成本高回報。 |
| P2-10 | **`ai-pr-review.yml` diff 硬截斷 150 行** | 超過就只送前 150 行加一句「已截斷」。大 PR（例如 PR #30）的 review 等於只看了開頭，review 品質與 PR 大小成反比。 |
| P2-11 | **文件與實作脫節** | README 測試數（40/20 vs 實際 78/42）、CLAUDE.md §2/§5 的「待改善項目」其實都做完了、§6 整章未實作卻寫得像已存在。**文件失去了待辦清單的功能**，接手者會照著修已經修好的東西。 |
| P2-12 | **`累積天數` 名不副實** | `hist.log.length` 是記錄筆數，不是相異天數。在 P1-2 修好前會顯示「一天 = 2 天」。 |

### 🟢 P3 — 品質優化，不影響目前產品

| # | 項目 |
|---|---|
| P3-1 | `assets/og-image.svg` 無任何引用（dead asset）。 |
| P3-2 | Google Fonts 用 CSS `@import`（阻塞 CSSOM），且 `font-family` 退路只到泛型 `serif`。改 `<link rel="preconnect">` 可改善長輩低速連線的首屏。 |
| P3-3 | `js/logic.js:17` 註解「與 index.html #si 的 max 屬性對齊」已過期（`#si` 現在 `js/render/step.js`）。 |
| P3-4 | 無 skip link；`index.html` 的 `<main id="mainArea">` 無 `aria-live`，畫面整段抽換時讀屏使用者不會被告知。 |
| P3-5 | `test.yml` 缺 CLAUDE.md §4 明文要求的獨立 `integration-tests` job（實質已由 `npm test` glob 涵蓋）。 |
| P3-6 | 同一裝置開兩個分頁會互相覆寫 `_data`／`_hist`（後寫贏）。低機率。 |
| P3-7 | `rebalance_questions.py`／`seed_questions.py` 共 864 行一次性腳本留在 root，未標示為歸檔。 |

### 明確**不列**為技術債的項目

| 項目 | 為何不列 |
|---|---|
| 沒有 npm dependencies / lockfile | **這是資產**。零供應鏈風險、零 `npm audit`、零版本衝突、改完重整就看到。 |
| 沒有框架 / build step | 950 行 JS 不需要框架。導入只會增加維護面而不增加使用者價值。 |
| 沒有 TypeScript | 規模小 + runtime `isValid*` 驗證 + 120 個測試已足夠。 |
| 沒有登入 / 帳號系統 | **零摩擦是核心產品價值**，不是遺漏。 |
| `seed_questions.py` 718 行 | 一次性可重現腳本，有測試守著，不是 dead code。 |
| `api/questions.js` 281 行 | 每個函式都在 40 行以內，職責清楚，有 32 個測試。行數不等於債。 |

---

## Risks

| # | 風險 | 機率 | 衝擊 | 說明 |
|---|---|---|---|---|
| R1 | **題庫永久凍結** | 高 | 高 | `google-generativeai` 已終止支援 + 未鎖版本 + 失敗無告警。某個週日無聲死亡，可能好幾個月後才有人發現（就像 P0-1 一樣）。 |
| R2 | **使用者對分數/天數失去信任** | 中 | 高 | P1-2 讓「連續達標天數」這個核心黏著指標可能顯示錯誤數字。對長者產品，「數字不對」等於「這個東西壞了」，而且**資料只在 localStorage，錯了無法從伺服器修正**。 |
| R3 | **核心機制退化** | 中 | 高 | P1-4：人工題庫每週被無審查 AI 題替換，難度校準只驗結構。步數↔難度耦合是唯一原創機制，它失效產品就失去差異化。 |
| R4 | **修好也送不到使用者面前** | 已發生 | 高 | P0-1。任何題庫改善在修好交付管線前都不會上線。 |
| R5 | **使用者資料永久遺失** | 高 | 中 | 換手機／清快取／換瀏覽器 = 累積分數與連續天數歸零，**且無匯出、無備份、無還原**。對「連續 100 天」這種情感投資，一次歸零就是永久流失。 |
| R6 | **Gemini 配額被洗版** | 低 | 中 | 限流僅單實例 best-effort。origin allowlist 是主要防線，但 origin header 可偽造（非瀏覽器請求）。目前流量低故機率低。 |
| R7 | **回歸缺陷無法被攔截** | 中 | 中 | `js/app.js` + `js/render/*` 共 513 行零測試覆蓋。任何人動狀態轉換，CI 全綠也可能壞掉——P1-2 就是活生生的例子。 |
| R8 | **接手者照著過期文件工作** | 高 | 低 | CLAUDE.md §2/§5 的待辦已完成、§6 從未實作。新接手者會浪費時間修已修好的、並誤以為維運機制存在。 |
| R9 | **後端設定不可重建** | 低 | 中 | 無 `vercel.json`。Vercel 專案若被刪除或誤設，repo 內沒有任何資訊可重建。 |
| R10 | **AI 功能可能根本沒開** | 中 | 中 | `AI_PROXY_URL` 是否設定無法從 repo 判斷。若未設定，`api/questions.js`（281 行）+ `js/ai.js`（64 行）+ 39 個相關測試 + Loading UI **全都是 dead code in production**，而「AI 出題」是專案投入最多的差異化功能。 |

---

## Source of Truth

| 項目 | Source of Truth | 說明 |
|---|---|---|
| **Product specification** | **尚不存在** | 沒有 PRD、沒有 spec 文件。最接近的是 `README.md` 的前兩段（產品描述）與 `js/logic.js` 的常數（`STREAK_STEP_GOAL=3000`、`QUESTIONS_PER_DAY=3`、`getDiff` 的四級門檻）——**規格實質上寫在程式碼裡**。`CLAUDE.md` 是開發標準，不是產品規格。 |
| **UI / UX** | **Repository code** | `css/styles.css` + `js/render/*`。無 Figma、無設計稿、無 wireframe。 |
| **Design system** | **尚不存在** | 事實上的 token 來源是 `css/styles.css:3-6` 的 9 個 CSS variables（`--bg`/`--paper`/`--ink`/`--accent`…）。沒有元件庫、沒有文件、沒有命名規範。對此規模是可接受的。 |
| **Frontend** | **Repository code** | `js/` 目錄。無歧義。 |
| **Backend** | **Repository code + 外部服務（分裂）** | 程式碼在 `api/questions.js`（可信），但**部署設定、環境變數、實際 runtime 行為只存在 Vercel 控制台**，repo 內無 `vercel.json`。這是唯一「真相分裂在 repo 之外」的一層。 |
| **Data model** | **`js/logic.js`（主）+ `generate_questions.py`（副本）** | `isValidQuestion` / `isValidQuestionBank` 是主要定義，`api/questions.js` 已正確 import 共用。**但 Python 的 `validate_questions` 是第二份獨立實作**，兩者目前規則等價純屬維護得好，沒有機制保證。 |
| **Deployment** | **`.github/workflows/*.yml` + GitHub 設定（分裂）** | Workflow 邏輯在 repo，但 Secrets／Variables 的**實際值與是否設定**只存在 GitHub 設定頁。`AI_PROXY_URL` 是否存在直接決定一個主要功能開不開，卻無法從 repo 得知。 |
| **Product status** | **Git history + GitHub Actions 執行歷史** | **不是 README**。README 說「每週自動擴充」，Actions 歷史說「8 次更新從未部署」。**本次盤點最關鍵的三個發現全部來自 Actions 執行歷史與 runtime 實測，沒有一個來自文件。** |

### 規格與實作不一致（明確列出）

| # | 規格說 | 實作是 | 嚴重度 |
|---|---|---|---|
| 1 | README：「GitHub Actions 每週自動擴充」、UI 文案：「每週自動更新」 | 進了 repo 但**沒進線上**（61 天零部署） | **P0** |
| 2 | CLAUDE.md §6：異常偵測閾值、自動開 issue、hot-fix 協議 | **整章零實作**，無對應 workflow、無 named constant | P1 |
| 3 | CLAUDE.md §4：`test.yml` 需有 `integration-tests` job | 不存在（由 `npm test` glob 涵蓋，結果等價） | P3 |
| 4 | CLAUDE.md §2：`api/questions.js:143` 非結構化 log 待改 | **已改好**，行號也已過期 | P2（文件債） |
| 5 | CLAUDE.md §2：`js/ai.js:35` silent swallow 待補 | **已補好** | P2（文件債） |
| 6 | CLAUDE.md §5：三項「已知待處理」 | **三項全部完成** | P2（文件債） |
| 7 | README：「共 40 個測試」「20 個測試」 | 78 / 42 | P3 |
| 8 | `js/logic.js:17`：「與 index.html #si 的 max 對齊」 | `#si` 在 `js/render/step.js` | P3 |
| 9 | UI 文案：「累積天數」 | 實為 log 筆數（同日可多筆） | P2 |

---

## Open Questions

> 以下問題**無法從 repository 本身回答**，需要存取外部系統或產品決策。按重要性排序。

1. **線上的 `AI_PROXY_URL` 到底有沒有設定？**
   這決定了 345 行程式碼 + 39 個測試 + 整個 Loading UI 是「核心差異化功能」還是「production dead code」。
   → 驗證方式：`curl -s https://lwc1129.github.io/brain-game/js/config.js`
   （本 session 的 egress proxy 擋住 `lwc1129.github.io`，無法代為確認）。

2. **Vercel 專案還活著嗎？`GEMINI_API_KEY` 還有效嗎？**
   repo 內無 `vercel.json`、無 deployment 紀錄。若 proxy 已失效，前端會靜默降級到題庫，
   **沒有任何人會發現**（因為錯誤完全不對使用者顯示）。

3. **GA4 有沒有啟用？如果有，目前的真實數據是什麼？**
   有多少 DAU？`start_game` → `complete_game` 的完成率多少？7 日留存？
   這是判斷「該修品質還是該找使用者」的唯一依據，而本次盤點完全拿不到。

4. **有真實使用者嗎？是誰？**
   分享文案與贊助 CTA 顯示這是面向真實家庭的產品，但 repo 內沒有任何使用者回饋、
   沒有 issue、沒有 analytics 快照。**目前有 0 個家庭在用，和有 50 個家庭在用，
   後續優先序完全不同。**

5. **「連續達標天數」歸零可接受嗎？**
   目前資料只在 localStorage，換裝置即全失。若這是核心黏著機制，
   就必須決定：① 接受（維持零摩擦）② 加匯出/匯入（低成本折衷）③ 做帳號系統（高成本）。
   **這是產品決策，不是工程決策。**

6. **題庫要長成 AI 產的，還是要保留人工品質基準？**
   目前的機制（滿 300 題後每週汰舊換新）預設了「AI 產的最終會全面取代人工種題」。
   這是刻意的嗎？還是 `MAX_PER_DIFFICULTY` 上限的意外副作用？

7. **CLAUDE.md §6「無人值守維運」是目標還是願景？**
   整章從未實作。如果是目標，需要排進 roadmap；如果只是願景，應該把它從「標準」
   降級為「未來方向」，否則它會一直讓文件看起來像在說謊。

8. **2026-07-10 到 2026-09-09 之間發生什麼事？**
   Git history 顯示這 61 天只有機器人的題庫 commit，沒有任何人類開發。
   專案是暫停了、還是進入穩定維護期？這影響 roadmap 該排多重。

---

## Recommended Roadmap

> 每個 Phase 最多 3～5 個主題。**這是方向，不是現在要全部執行的工單。**

### Phase 0｜解除目前阻塞

| # | 主題 | 為什麼現在 |
|---|---|---|
| 0-1 | **修復「題庫更新 → GitHub Pages」交付斷點**（P0-1） | 在這修好前，任何題庫改善都送不到使用者面前。同時恢復自動產生內容的 CI schema 驗證。 |
| 0-2 | **修復返回主頁的重複計分**（P1-2），並補上對應 integration test | 使用者看得到的資料錯誤。修法已有現成範本（重試路徑做對了）。 |
| 0-3 | **確認線上 AI 與 GA 的實際開關狀態**（Open Questions 1–3） | 不確認就無法判斷 345 行 AI 程式碼是資產還是 dead code，Phase 1 的優先序會排錯。 |

### Phase 1｜補齊核心產品

| # | 主題 | 為什麼 |
|---|---|---|
| 1-1 | **題庫生成管線韌性**（P1-3）：遷移 `google-genai` + 鎖版本 + 逐題過濾取代整批全滅 + 失敗告警 | 消除「題庫某天無聲凍結」這個最高機率的風險。 |
| 1-2 | **題庫難度校準**（P1-4）：加入難度 heuristic 或抽樣審查，讓 `hard` 真的比 `super_easy` 難 | 保護產品唯一的原創機制。 |
| 1-3 | **使用者資料可攜**：匯出／匯入 JSON（不做帳號系統） | 以最低成本解掉 R5。零摩擦不受影響。 |
| 1-4 | **關鍵流程的 DOM 測試**（P2-2）：只覆蓋三個狀態轉換與返回/重試路徑 | 不是補滿覆蓋率，是守住 P1-2 那類缺陷的唯一結構性方法。 |
| 1-5 | **文件校正**（P2-11）：README 數字、CLAUDE.md §2/§5 已完成項目、§6 定位 | 讓文件重新能當待辦清單用。低成本、高接手效率回報。 |

### Phase 2｜Production Readiness

| # | 主題 | 為什麼 |
|---|---|---|
| 2-1 | **實作 CLAUDE.md §6 的維運機制**：排程/部署失敗 → Slack 或自動開 issue | 現有的 `ai-pr-review.yml` Slack 步驟可直接當範本。 |
| 2-2 | **前端錯誤收集**（P2-4）：把 `logError` 送到一個真的有人看的地方 | 目前前端 log 等於沒寫。 |
| 2-3 | **後端設定入 repo**：`vercel.json` + 環境變數清單文件（P2-6） | 消除唯一的「真相在 repo 之外」黑箱。 |
| 2-4 | **輕量 lint + preview 環境**（P2-1、P2-7）：`node --check` 進 CI + Vercel preview | 在不破壞零依賴原則下建立最小品質閘門。 |
| 2-5 | **限流升級到跨實例**（P2-5）：Vercel KV / Upstash | **只在有真實流量後才做**，不要提前優化。 |

---

## Next Action

### 唯一下一步

> **修復「每週題庫更新 → GitHub Pages」的交付斷點：讓 `update_questions.yml` 的 push 能夠實際觸發 `deploy.yml`。**

### 為什麼是它

1. 它讓 README 與 UI 文案上的招牌功能「每週自動更新題庫」**在使用者端重新成立**——目前已失效 61 天。
2. 它同時恢復 `test.yml` 對自動產生內容的 schema 驗證，**這道防線從未在任何一批 AI 題目上執行過**。
3. 它是真正的阻塞：P1-4（題庫品質）與 Phase 1 的所有題庫工作，修好它之前**都送不到使用者面前**。
4. 改動極小（一個 workflow 的 `on:` 區塊），可客觀驗證，且不觸碰任何產品程式碼——完全符合本輪「不做大型重構」的約束。
5. 相較之下 P1-2 雖然同樣重要，但它走的是一般 push 路徑（人類 merge 會正常部署），**不被這個斷點阻塞**，可以排在其後。

### 完成標準（Definition of Done）

1. `deploy.yml` 新增 `workflow_run`（監聽「每週自動更新題庫」完成）+ `workflow_dispatch` 觸發，
   並以 `if: github.event.workflow_run.conclusion == 'success'` 確保失敗的排程不會觸發部署。
2. 手動 `workflow_dispatch` 執行 `update_questions.yml` 後，**GitHub Actions 上出現一次新的
   `Deploy to GitHub Pages` 執行且 conclusion 為 success**（可在 Actions 頁面直接核對）。
3. `curl -s https://lwc1129.github.io/brain-game/questions.json | shasum` 的結果
   **等於** `shasum questions.json`（main 最新版）——即線上檔案與 repo 一致。
4. `npm test`（78 passed）與 `python -m unittest test_generate_questions -v`（42 passed）皆 exit 0。
5. PR description 含 CLAUDE.md §1 要求的四道安全防線聲明
   （本次不動 `api/questions.js`，故聲明「四項防線未經觸碰、完整保留」）。
6. 順手在 `README.md` 的部署章節補一行說明「題庫更新後如何確認已送達線上」，
   讓下一個接手者不需要重新發現這件事。

### 預計影響

| 類型 | 項目 |
|---|---|
| **Files（修改）** | `.github/workflows/deploy.yml`（`on:` 區塊 + job 的 `if:` 條件） |
| **Files（可能修改）** | `.github/workflows/update_questions.yml`（若改採 `gh workflow run` 方案）、`README.md`（部署章節補充） |
| **Files（不動）** | 全部產品程式碼：`js/`、`api/`、`css/`、`index.html`、`*.py`、`tests/` |
| **Routes** | 無（無路由系統） |
| **Flow** | 「每週排程 → 題庫更新 → 線上生效」這條 CI/CD flow。**使用者流程零變更。** |
| **風險** | 極低。最壞情況是部署多觸發一次（`concurrency: pages` + `cancel-in-progress` 已處理併發）。 |

### 建議執行工具

**Claude Code** —— 改動範圍侷限在 GitHub Actions workflow YAML，需要對照 Actions 執行歷史驗證結果，
在同一個 session 內即可完成編輯、開 PR、並在 PR merge 後核對部署是否真的被觸發。
**不需要** Figma（無設計改動）、**不需要** 其他工具。

---

*本報告由完整 repository 閱讀、實際執行測試（`npm test` 78 passed / `unittest` 42 passed）、
Chromium headless 實跑 15 項使用者流程檢查、以及 GitHub Actions 執行歷史查核產生。
盤點期間未修改任何產品程式碼。*
