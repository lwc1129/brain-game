// 部署時由 CI 注入實際值（見 .github/workflows/deploy.yml），
// 原始碼中一律留空，不得放任何金鑰。
export const CONFIG = {
  // GA4 Measurement ID（選用）
  GA_MEASUREMENT_ID: '',
  // AI 出題後端 proxy 網址（選用）。Gemini API key 只存在於 proxy 端，
  // 前端絕不直接持有金鑰。留空時自動改用題庫出題。
  AI_PROXY_URL: '',
};

export const APP_NAMESPACE = 'brain-game';
