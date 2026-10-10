// Lazy loaders for vendored map libs (no CDN, no keys).
const loaded = {};
const script = src => loaded[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
export async function loadLeaflet() {
  if (!document.querySelector('link[href*="leaflet.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/static/vendor/leaflet.css'; document.head.append(l); }
  await script('/static/vendor/leaflet.js'); return window.L;
}
export async function loadWorld() { await script('/static/vendor/topojson-client.min.js'); return window.topojson; }
export async function loadCharts() { await script('/static/vendor/apexcharts.min.js'); return window.ApexCharts; }
export const loadQR = () => script('/static/vendor/qrcode.js').then(() => window.qrcode);
export const loadJsQR = () => script('/static/vendor/jsQR.js').then(() => window.jsQR);
