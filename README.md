# brain-game：每日認知挑戰

給長者的每日腦力訓練小遊戲：輸入今日步數決定題目難度（走得多→題目簡單），
每天 3 題，答題累積分數與連續達標天數。部署於 GitHub Pages。

## 專案結構

```
index.html                  頁面骨架（不含樣式與邏輯）
css/styles.css              樣式（rem 單位、響應式斷點、無障礙焦點樣式）
js/
  config.js                 執行期設定（CI 注入 GA ID 與 AI proxy 網址）
  logic.js                  純函式遊戲邏輯（可在 Node 直接測試）
  fallback-questions.js     內建 120 題 fallback 題庫
  storage.js                localStorage 存取（含近期出題記錄、字體偏好）
  ai.js                     AI 出題（一律經由後端 proxy，前端無金鑰）
  analytics.js              GA4 事件
  app.js                    畫面渲染與事件繫結（進入點）
tests/logic.test.mjs        前端邏輯單元測試（node --test）
api/questions.js            Vercel Serverless Function：Gemini API 代理（金鑰保管處）
generate_questions.py       每週題庫擴充腳本（合併＋去重＋上限）
test_generate_questions.py  題庫腳本單元測試
questions.json              動態題庫（GitHub Actions 每週自動擴充）
```

## 安全性：Gemini API key 的處理

- **前端與部署產物中沒有任何金鑰。** AI 出題經由 `api/questions.js`
  （Vercel Serverless Function）代理，金鑰存在 Vercel 環境變數，
  並以 `ALLOWED_ORIGINS` 限制來源（預設只允許本專案的 GitHub Pages）。
- `js/config.js` 的 `AI_PROXY_URL` 是可公開的 proxy 網址；未設定時，
  前端自動改用題庫出題，遊戲功能完整可用。GitHub repository variable
  `AI_PROXY_URL` 可在部署時覆寫它。
- 每週題庫更新（GitHub Actions）在伺服器端使用 `secrets.GEMINI_API_KEY`，不經前端。

### AI proxy 設定（一次性）

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 申請 API key
   （舊 key 若曾被舊版部署流程寫進前端，請作廢重發）。
2. 到 [vercel.com/new](https://vercel.com/new) 匯入本 repo，
   Framework Preset 選「Other」，並在 Environment Variables 加上
   `GEMINI_API_KEY`，按 Deploy。
3. 把部署後的網域（例如 `https://brain-game-xxx.vercel.app`）加上
   `/api/questions` 路徑，到 GitHub repo 的 **Settings → Secrets and variables → Actions → Variables**，
   新增 Repository variable `AI_PROXY_URL`（名稱需與 `.github/workflows/deploy.yml` 一致）。
   `js/config.js` 請保持提交時的空白預設值，不要直接編輯——
   deploy workflow 會在部署時自動注入此值；GitHub Pages 只在此變數存在時才會啟用 AI 出題。

之後每次 push，Vercel 會自動重新部署 API；GitHub Pages 照常部署遊戲本體。

## 題庫

- 內建 fallback 題庫 120 題（hard / medium / easy / super_easy 各 30 題），離線可玩。
- `questions.json` 由 GitHub Actions 每週呼叫 Gemini 自動「擴充」：
  新題與舊題合併、以題目文字去重、每難度上限 200 題（超過時淘汰最舊）。
- 前端記錄每個難度最近 21 題（約一週份量），抽題時優先排除，降低重複感。
- 選項順序在出題時隨機打亂。

## 無障礙（目標客群：長者）

- 字體大小切換（標準／大／特大），偏好存於 localStorage，整體以 rem 縮放。
- 響應式版面：手機單欄、平板與桌機加寬，桌機選項雙欄。
- ARIA：landmark、表單 label、`role="group"`、作答結果與載入狀態 `role="status"`。
- 可見的鍵盤焦點樣式（`:focus-visible`）、按鈕觸控目標至少 48px。
- 尊重 `prefers-reduced-motion`。

## 開發

純靜態網站，無建置步驟。本地預覽：

```bash
python3 -m http.server 8000   # 開啟 http://localhost:8000
```

執行測試：

```bash
python -m unittest test_generate_questions -v   # 題庫腳本（20 個測試）
node --test tests/*.test.mjs                    # 前端邏輯（19 個測試）
```

CI（`.github/workflows/test.yml`）會在 push / PR 時跑上述測試，
並驗證 `questions.json` 符合前端題庫 schema。

## 部署

- push 到 `main` 後由 `.github/workflows/deploy.yml` 部署至 GitHub Pages。
- 每週日 UTC 16:00（台灣週一 00:00）由 `.github/workflows/update_questions.yml`
  自動擴充題庫。
