# AGENTS.md

專案開發標準請見 `CLAUDE.md`（Security / Logging / Tests / Refactoring / Operations）。
一般開發、測試、部署指令請見 `README.md`。

## Cursor Cloud specific instructions

此為純靜態網站（GitHub Pages + Vanilla JS ES modules），**無 build step、無外部 npm 依賴**；
Python 腳本只用標準庫。因此環境無需安裝任何套件即可開發與測試。

### 服務與執行

- **前端（唯一需要長時間執行的服務）**：純靜態站，用 `python3 -m http.server 8000` 服務後開
  `http://localhost:8000/`。無熱重載，改完檔案直接重新整理瀏覽器即可。
- **後端 `api/questions.js`**：Vercel Serverless（Gemini proxy），本地不需要也不會啟動；
  前端在 `js/config.js` 的 `AI_PROXY_URL` 為空時自動改用 `questions.json`／內建 fallback 題庫，
  遊戲完整可玩。本地測試不需要 `GEMINI_API_KEY`（該金鑰只用於 Vercel 與每週題庫 workflow）。

### 測試 / Lint

- 指令見 `README.md` 與 `CLAUDE.md`：`npm test`（Node 原生 test runner，含整合測試）與
  `python -m unittest test_generate_questions -v`。兩者皆免依賴、可直接執行。
- 此 repo **沒有設定 linter（無 ESLint／Prettier）**。若要快速語法檢查，可用
  `node --check <file>` 逐檔驗證 JS。

### 非顯而易見的注意事項

- 基底映像預設**沒有 `python` 這個指令**（只有 `python3`）。`CLAUDE.md`／`README.md` 的
  `python -m unittest ...` 指令因此在乾淨環境會失敗。環境啟動腳本（update script）會建立
  `/usr/local/bin/python → python3` 的 symlink 修正此問題；若未生效，請改用 `python3`。
