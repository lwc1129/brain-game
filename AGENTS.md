# AGENTS.md

規則見 `CLAUDE.md`。結構與設定見 `README.md`。

## Cursor Cloud 補充

- 本地預覽：`python3 -m http.server 8000`，開 `http://localhost:8000/`。`js/config.js` 的 `AI_PROXY_URL` 為空時自動用題庫，不需要 `GEMINI_API_KEY`。
- 基底映像沒有 `python` 指令，一律用 `python3`。
- 沒有 linter；語法檢查用 `node --check <file>`。
