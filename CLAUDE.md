# brain-game 開發規則

給台灣長者的每日認知挑戰。前端：GitHub Pages + Vanilla JS（ES modules，無 build、無 npm 依賴）。
後端：Vercel Serverless `api/questions.js`（Gemini proxy）。

## 動手前

- 先 `git fetch`，確認工作基準是 `origin/main`。本檔若與程式不一致，以程式與測試為準，並回報。
- 改程式、commit、push、開 PR、合併都需要 Linus 明確核准。唯讀查詢不用問。
- 一律從 `main` 開分支、用 PR 合回，不直接 push `main`。

## 測試（合併前三組都要過）

- `npm test`
- `npm run test:e2e`（需先 `npm install --no-save playwright`）
- `python3 -m unittest test_generate_questions test_difficulty_eval -v`

## 不可削弱的防線（都有測試鎖住，改動時測試必須仍然通過）

- `api/questions.js` 的處理順序：origin → 難度白名單 → 限流 → 快取 → Gemini。
- `GEMINI_API_KEY` 只存在 Vercel 環境變數與 GitHub Actions secret。`js/config.js` 提交時兩個值必須是空字串。
- 進入 prompt 的任何參數先過白名單。prompt 最後一行要求「只回傳 JSON」。
- AI 回應先過 `isValidQuestions`（定義在 `js/logic.js`，proxy 與前端共用）才能使用。
- AI 來源字串進 DOM 前一律 `escapeHtml()`（`js/render/helpers.js`）。
- `generate_questions.py` 的單題驗證規則必須與 `js/logic.js` 一致（有一致性測試）。

## 寫程式的慣例

- 錯誤路徑要留結構化 log，欄位為 `level`、`ts`、`msg`、`ctx`：後端用 `logJson(level, msg, ctx)`，前端用 `js/logger.js` 的 `logError(context, error)`。不留沒有 log 的 catch。
- 新的純函式、新的 request 參數、新的 `isValid*` 都要有測試（合法、非法、邊界）。測試不發真實網路請求。
- 新增前端執行期檔案時，同步更新 `scripts/build_site.sh` 與 `sw.js` 的 `PRECACHE`。
- 調整 `api/questions.js`、`js/ai.js`、`js/storage.js`、`js/app.js` 頂端的具名常數前，先讀該常數旁的註解。

## PR

- 重構與功能／修正分開 PR。描述這次變更的文件修改跟著同一個 PR 走，不另開。
- 合併後才算完成：`Deploy to GitHub Pages` 這次執行裡的 `test`、`deploy`、`smoke` 三段都綠（`smoke` 會實際對正式站 `/api/questions` 出題）。缺任何一段就回報「未驗證」。
- 待辦放 GitHub Issue，PR 本文用 `Closes #N`。本檔不列待辦、不記狀態。

## 目前沒有的東西（不要當成已存在）

- 沒有異常偵測與自動修復。`smoke-prod.yml` 只在部署後與每天一次打正式站；其餘時間的 502 只能從 Vercel 執行紀錄得知（Hobby 方案保留約 1 小時）。
- 測試閘門只擋 GitHub Pages。Vercel 的 API 在合併後一律自動部署，不看測試結果。
- 沒有 AI 自動審查 PR 的 workflow。
- CI 不測真實 Gemini、真實手機、PWA 安裝。
