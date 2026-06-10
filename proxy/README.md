# brain-game AI 出題 Proxy

Cloudflare Worker，負責代理前端對 Gemini API 的呼叫。
**Gemini API key 只存在於這裡（Worker secret），前端程式碼與部署產物中不含任何金鑰。**

## 為什麼需要 proxy

GitHub Pages 是純靜態網站，任何寫進前端 JS 的金鑰都等於公開。
因此前端只送出 `{ "difficulty": "easy" }` 這類請求，由 Worker 持金鑰呼叫 Gemini、
驗證回傳格式後，再把題目回給前端。

## 部署步驟

1. 安裝 [wrangler](https://developers.cloudflare.com/workers/wrangler/) 並登入：

   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. 修改 `wrangler.toml` 的 `ALLOWED_ORIGINS` 為你的 GitHub Pages 網址。

3. 設定金鑰並部署：

   ```bash
   cd proxy
   wrangler secret put GEMINI_API_KEY   # 貼上 Google AI Studio API key
   wrangler deploy
   ```

4. 把部署後得到的 Worker 網址（例如 `https://brain-game-ai-proxy.<account>.workers.dev`）
   設成 GitHub repository variable `AI_PROXY_URL`
   （Settings → Secrets and variables → Actions → Variables）。
   部署 workflow 會把它注入 `js/config.js`。

`AI_PROXY_URL` 留空時，前端自動改用題庫出題，遊戲功能不受影響。

## API

```
POST /
Content-Type: application/json

{ "difficulty": "hard" | "medium" | "easy" | "super_easy" }
```

成功回應：

```json
{ "questions": [ { "type": "計算", "q": "…", "a": "…", "opts": ["…","…","…","…"] } ] }
```

失敗時回傳 4xx/5xx 與 `{ "error": "…" }`，前端會 fallback 至題庫出題。
