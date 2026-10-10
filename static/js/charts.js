// Tiny hand-made SVG charts in the app's fonts: one accent series, neutral support, direct labels. No library, no layout shift.
const ns = 'http://www.w3.org/2000/svg';
const mk = (t, a = {}) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

// bars for a daily series (values may be null); highlights the last point; draws the average as a dashed line
export function bars(values, { w = 320, h = 90, goal, fmt = v => v, label = '' } = {}) {
  const svg = mk('svg', { viewBox: `0 0 ${w} ${h + 18}`, class: 'chart', role: 'img', 'aria-label': label }), nums = values.filter(v => v != null), max = Math.max(...nums, goal || 0, 1), bw = w / values.length;
  if (!nums.length) { const t = mk('text', { x: 6, y: h / 2, fill: 'var(--ink-3)', 'font-size': 14, 'font-family': 'var(--f-hand)' }); t.textContent = 'No data yet'; svg.append(t); return svg; }
  values.forEach((v, i) => { if (v == null) return; const bh = Math.max(2, v / max * h); svg.append(mk('rect', { x: i * bw + 1, y: h - bh, width: Math.max(1, bw - 2), height: bh, rx: 1.5, fill: i === values.length - 1 ? 'var(--pen)' : 'var(--ink-3)', opacity: i === values.length - 1 ? 1 : .5 })); });
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length; svg.append(mk('line', { x1: 0, x2: w, y1: h - avg / max * h, y2: h - avg / max * h, stroke: 'var(--ink-2)', 'stroke-dasharray': '3 4', 'stroke-width': 1 }));
  if (goal) svg.append(mk('line', { x1: 0, x2: w, y1: h - goal / max * h, y2: h - goal / max * h, stroke: 'var(--good)', 'stroke-width': 1 }));
  const t = mk('text', { x: w, y: h + 14, 'text-anchor': 'end', fill: 'var(--ink-2)', 'font-size': 13, 'font-family': 'var(--f-hand)' }); t.textContent = `avg ${fmt(Math.round(avg * 10) / 10)}`; svg.append(t);
  return svg;
}
// smooth-ish line with direct end label
export function line(values, { w = 320, h = 70, min, max, label = '' } = {}) {
  const svg = mk('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': label }), pts = values.map((v, i) => v == null ? null : [i / Math.max(1, values.length - 1) * (w - 8) + 4, v]).filter(Boolean);
  if (pts.length < 2) return svg;
  const lo = min ?? Math.min(...pts.map(p => p[1])), hi = max ?? Math.max(...pts.map(p => p[1])), y = v => h - 6 - (v - lo) / Math.max(1e-9, hi - lo) * (h - 14);
  svg.append(mk('polyline', { points: pts.map(p => `${p[0]},${y(p[1])}`).join(' '), fill: 'none', stroke: 'var(--pen)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const l = pts[pts.length - 1]; svg.append(mk('circle', { cx: l[0], cy: y(l[1]), r: 3.5, fill: 'var(--pen)' })); return svg;
}
// calendar-ish heatmap for a daily 1-5 value: rows = weeks
export function heat(map, days, { cell = 16 } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'heat';
  for (let i = 0; i < days.length; i += 7) { const col = document.createElement('div'); days.slice(i, i + 7).forEach(d => { const v = map[d], s = document.createElement('span'); s.className = 'hc'; s.title = d + (v ? ' · ' + v.toFixed(1) : ''); if (v != null) { s.style.background = `color-mix(in srgb, var(--d-health) ${Math.round((v - 1) / 4 * 80 + 15)}%, var(--panel))`; s.style.borderColor = 'transparent'; } col.append(s); }); wrap.append(col); }
  return wrap;
}
