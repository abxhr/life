// CSV in/out (RFC 4180-ish): quotes, embedded commas/newlines, BOM. Used for list import/export so your data is never locked in.
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false, i = 0; text = text.replace(/^﻿/, '');
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export const toCSV = (header, rows) => [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
// header names -> field keys by case-insensitive match on key or label (title/name/item are aliases for the title)
export function mapColumns(header, fields) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return header.map(h => { const n = norm(h); if (['title', 'name', 'item', 'what'].includes(n)) return 'title'; if (['status', 'state'].includes(n)) return 'status'; if (['notes', 'note', 'comment', 'comments'].includes(n)) return 'notes'; if (['tags', 'tag'].includes(n)) return 'tags'; const f = fields.find(x => norm(x.k) === n || norm(x.label) === n); return f ? f.k : null; });
}
export function rowsToItems(rows, fields) {
  const [header, ...body] = rows, map = mapColumns(header, fields), numeric = new Set(fields.filter(f => f.type === 'number' || f.type === 'rating').map(f => f.k));
  return body.map(r => { const it = {}; map.forEach((k, idx) => { if (!k || r[idx] == null || r[idx] === '') return; it[k] = k === 'tags' ? r[idx].split(/[;,]/).map(s => s.trim()).filter(Boolean) : numeric.has(k) ? (Number.isNaN(+r[idx]) ? r[idx] : +r[idx]) : r[idx]; }); return it; }).filter(it => it.title);
}
