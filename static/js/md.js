// Tiny safe Markdown renderer (DOM nodes, never innerHTML): headings, lists, checklists, tables, code fences,
// images from our own file store, bold/italic/code, links, [[wiki links]].
import { h } from './util.js';

const INLINE = /(!\[([^\]]*)\]\((\/api\/files\/[\w-]+)\)|\[\[([^\]]+)\]\]|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:|\/api\/files\/)[^)\s]+)\))/g;

function inline(t) {
  const frag = []; let i = 0, m; INLINE.lastIndex = 0;
  while ((m = INLINE.exec(t))) {
    if (m.index > i) frag.push(t.slice(i, m.index));
    if (m[3]) frag.push(h('img', { src: m[3], alt: m[2], style: { maxWidth: '100%', borderRadius: '4px' } }));
    else if (m[4]) frag.push(h('a', { href: '#/notes?link=' + encodeURIComponent(m[4]) }, m[4]));
    else if (m[5]) frag.push(h('b', {}, m[5]));
    else if (m[6]) frag.push(h('i', {}, m[6]));
    else if (m[7]) frag.push(h('code', {}, m[7]));
    else frag.push(h('a', { href: m[9], target: '_blank', rel: 'noopener noreferrer' }, m[8]));
    i = INLINE.lastIndex;
  }
  if (i < t.length) frag.push(t.slice(i));
  return frag;
}

export function mdToNodes(src) {
  const out = []; let list = null, code = null, table = null;
  for (const ln of String(src || '').split('\n')) {
    let m;
    if (/^```/.test(ln)) { if (code) { out.push(code); code = null; } else code = h('pre', { style: { background: 'var(--panel-2)', padding: '8px 12px', borderRadius: '4px', overflowX: 'auto', margin: '0 0 8px' } }); continue; }
    if (code) { code.append(ln + '\n'); continue; }
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue;
      if (!table) out.push(h('div', { style: { overflowX: 'auto' } }, table = h('table', { class: 'tbl' })));
      const first = !table.children.length;
      table.append(h('tr', {}, ln.trim().replace(/^\||\|$/g, '').split('|').map(c => h(first ? 'th' : 'td', {}, inline(c.trim())))));
      continue;
    }
    table = null;
    if ((m = /^(#{1,3})\s+(.*)/.exec(ln))) { list = null; out.push(h('h' + (m[1].length + 1), {}, inline(m[2]))); }
    else if ((m = /^\s*[-*]\s+\[( |x)\]\s+(.*)/i.exec(ln))) { if (!list || list.tagName !== 'DIV') out.push(list = h('div', { class: 'stack-s' })); list.append(h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: m[1] !== ' ', disabled: true }), h('span', {}, inline(m[2])))); }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(ln))) { if (!list || list.tagName !== 'UL') out.push(list = h('ul', {})); list.append(h('li', {}, inline(m[1]))); }
    else if (ln.trim() === '') list = null;
    else { list = null; out.push(h('p', { style: { margin: '0 0 8px' } }, inline(ln))); }
  }
  if (code) out.push(code);
  return out;
}
