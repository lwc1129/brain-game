import { CONFIG } from './config.js';

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
  try {
    window.gtag('event', name, params);
  } catch {}
}
