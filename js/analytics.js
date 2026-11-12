import { CONFIG } from './config.js';
import { logError } from './logger.js';

export function initAnalytics() {
  if (!CONFIG.GA_MEASUREMENT_ID) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${CONFIG.GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', CONFIG.GA_MEASUREMENT_ID, { send_page_view: true });
}

export function trackEvent(name, params) {
  if (typeof window.gtag !== 'function') return;
  // GA 失敗不得影響遊戲流程，但要留下結構化 log 方便排查。
  try {
    window.gtag('event', name, params);
  } catch (e) {
    logError({ op: 'trackEvent', event: name }, e);
  }
}
