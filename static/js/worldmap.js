// Offline world map: TopoJSON (vendored) -> SVG, Miller projection. Scratch-map look: unvisited = foil, visited = revealed + coloured.
import { loadWorld } from './maps.js';

let cache;
const W = 1000, rad = Math.PI / 180;
const mx = lon => (lon + 180) / 360 * W;
const miller = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * rad));
const Y0 = miller(84), Y1 = miller(-58), my = lat => (Y0 - miller(Math.max(-58, Math.min(84, lat)))) / (Y0 - Y1) * (W * 0.56);
export const MAP_H = W * 0.56;

export async function world() {
  if (cache) return cache;
  const [topo, meta, tj] = await Promise.all([fetch('/static/vendor/countries-110m.json').then(r => r.json()), fetch('/static/vendor/world-meta.json').then(r => r.json()), loadWorld()]);
  const feats = tj.feature(topo, topo.objects.countries).features, list = [], byA2 = {};
  for (const f of feats) {
    const m = meta[String(f.id)] || meta[f.properties.name]; if (!m || m[0] === 'AQ' || m[0] === 'TF') continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = '', big = null, bigN = 0;
    const ringPath = pts => 'M' + pts.map(([lo, la]) => mx(lo).toFixed(1) + ',' + my(la).toFixed(1)).join('L') + 'Z';
    for (const poly of polys) {
      for (const ring of poly) {
        const cross = ring.some((p, i) => i && Math.abs(p[0] - ring[i - 1][0]) > 180);
        if (cross) d += ringPath(ring.map(([lo, la]) => [lo < 0 ? lo + 360 : lo, la])) + ringPath(ring.map(([lo, la]) => [lo > 0 ? lo - 360 : lo, la]));   // wraps the antimeridian (Russia, Fiji): draw both halves, the viewBox clips the overflow
        else d += ringPath(ring);
      }
      if (poly[0].length > bigN) { bigN = poly[0].length; big = poly[0]; }
    }
    // centre of the largest ring's bounding box (good enough for flight distance, "approximate")
    const los = big.map(p => p[0]), las = big.map(p => p[1]); const c = [(Math.min(...las) + Math.max(...las)) / 2, (Math.min(...los) + Math.max(...los)) / 2];
    const rec = { a2: m[0], name: m[1], continent: m[2], d, centre: c }; list.push(rec); byA2[m[0]] = rec;
  }
  cache = { list, byA2, byName: Object.fromEntries(list.map(c => [c.name.toLowerCase(), c])) };
  return cache;
}

// states: {a2: 'been'|'lived'|'want'|'planned'}
export function drawMap(box, w, states, { onPick, animate } = {}) {
  const ns = 'http://www.w3.org/2000/svg', mk = (t, a = {}) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${MAP_H}`, overflow: 'hidden', class: 'world' + (animate ? ' draw' : ''), role: 'img', 'aria-label': 'World map of places you have been and want to go' });
  const defs = mk('defs'), pat = mk('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }); pat.append(mk('rect', { width: 6, height: 6, fill: 'var(--panel)' }), mk('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--d-goals)', 'stroke-width': 2.4 }));
  const foil = mk('pattern', { id: 'foil', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }); foil.append(mk('rect', { width: 4, height: 4, fill: 'var(--foil)' }), mk('circle', { cx: 1, cy: 1, r: .6, fill: 'var(--foil-dot)' }), mk('circle', { cx: 3, cy: 3, r: .5, fill: 'var(--foil-dot)' }));
  defs.append(pat, foil); svg.append(defs);
  const g = mk('g'); svg.append(g); const paths = {};
  w.list.forEach((c, i) => { const p = mk('path', { d: c.d, class: 'ct ' + (states[c.a2] ? 'c-' + states[c.a2] : 'c-none'), 'data-a2': c.a2, pathLength: 1, style: `--i:${i}` }); const t = mk('title'); t.textContent = c.name + (states[c.a2] ? ' — ' + states[c.a2] : ''); p.append(t); if (onPick) p.addEventListener('click', () => onPick(c.a2)); g.append(p); paths[c.a2] = p; });
  box.replaceChildren(svg);
  // pan / zoom (wheel, drag, pinch, buttons) by moving the viewBox
  let vb = { x: 0, y: 0, w: W, h: MAP_H }; const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const zoom = (f, cx = .5, cy = .5) => { const nw = Math.max(W / 12, Math.min(W, vb.w * f)), nh = nw * MAP_H / W; vb.x += (vb.w - nw) * cx; vb.y += (vb.h - nh) * cy; vb.w = nw; vb.h = nh; clamp(); apply(); };
  const clamp = () => { vb.x = Math.max(0, Math.min(W - vb.w, vb.x)); vb.y = Math.max(0, Math.min(MAP_H - vb.h, vb.y)); };
  svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
  const pts = new Map(); let last = 0, moved = false;
  svg.addEventListener('pointerdown', e => { pts.set(e.pointerId, e); moved = false; });
  svg.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, e); const r = svg.getBoundingClientRect();
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (last) zoom(last / d, .5, .5); last = d; moved = true; }
    else if (vb.w < W) { const dx = (e.clientX - prev.clientX) / r.width * vb.w, dy = (e.clientY - prev.clientY) / r.height * vb.h; if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true; vb.x -= dx; vb.y -= dy; clamp(); apply(); } });
  const up = e => { pts.delete(e.pointerId); last = 0; }; svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('click', e => { if (moved) e.stopPropagation(); }, true);
  return { svg, paths, zoomIn: () => zoom(1 / 1.5), zoomOut: () => zoom(1.5), reset: () => { vb = { x: 0, y: 0, w: W, h: MAP_H }; apply(); } };
}
