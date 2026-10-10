// Formula + rollup engine for custom list fields. No eval: a tiny tokenizer and recursive-descent parser.
//   formula:  price * qty      ·  (a + b) / 2      ·  daysSince(last_done)      ·  if(rating >= 4, 1, 0)      ·  round(total, 1)
//   rollup:   sum / avg / min / max / count / countDone over a field of a list's items.
const FN = {
  round: (x, d = 0) => { const m = 10 ** d; return Math.round(x * m) / m; }, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  if: (c, a, b) => (c ? a : b), daysSince: (d, today) => d ? Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(String(d).slice(0, 10) + 'T12:00:00Z')) / 864e5) : null,
  daysUntil: (d, today) => d ? Math.floor((Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5) : null,
};
FN.daysSince.needsToday = FN.daysUntil.needsToday = true;   // only the date functions get "today" appended (min/max are variadic)
const TOK = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][\w]*)|(>=|<=|==|!=|[-+*/(),<>]))/y;

function tokenize(src) {
  const out = []; TOK.lastIndex = 0; let m, end = 0;
  while ((m = TOK.exec(src))) { if (m[1] != null) out.push(['n', +m[1]]); else if (m[2] != null) out.push(['id', m[2]]); else out.push(['op', m[3]]); end = TOK.lastIndex; }
  if (src.slice(end).trim()) throw new Error('Unexpected “' + src.slice(end).trim()[0] + '”');
  return out;
}
export function compile(src) {
  const t = tokenize(src); let i = 0;
  const peek = () => t[i], eat = () => t[i++], isOp = o => t[i] && t[i][0] === 'op' && t[i][1] === o;
  const num = v => (v == null || v === '' || Number.isNaN(+v) ? 0 : +v);
  function expr() { let l = add(); while (t[i] && t[i][0] === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t[i][1])) { const o = eat()[1], r = add(), a = l; l = env => { const x = a(env), y = r(env); return { '>': x > y, '<': x < y, '>=': x >= y, '<=': x <= y, '==': x == y, '!=': x != y }[o]; }; } return l; }
  function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = eat()[1], r = mul(), a = l; l = env => o === '+' ? num(a(env)) + num(r(env)) : num(a(env)) - num(r(env)); } return l; }
  function mul() { let l = unary(); while (isOp('*') || isOp('/')) { const o = eat()[1], r = unary(), a = l; l = env => { const x = num(a(env)), y = num(r(env)); return o === '*' ? x * y : y === 0 ? null : x / y; }; } return l; }
  function unary() { if (isOp('-')) { eat(); const a = unary(); return env => -num(a(env)); } return atom(); }
  function atom() {
    const k = eat(); if (!k) throw new Error('Unfinished formula');
    if (k[0] === 'n') return () => k[1];
    if (k[0] === 'op' && k[1] === '(') { const e = expr(); if (!isOp(')')) throw new Error('Missing )'); eat(); return e; }
    if (k[0] === 'id') {
      if (isOp('(')) { eat(); const args = []; if (!isOp(')')) { do { args.push(expr()); } while (isOp(',') && eat()); } if (!isOp(')')) throw new Error('Missing )'); eat(); const f = FN[k[1]]; if (!f) throw new Error('Unknown function ' + k[1]); return env => (f.needsToday ? f(...args.map(a => a(env)), env.__today) : f(...args.map(a => a(env)))); }
      return env => env[k[1]];
    }
    throw new Error('Unexpected “' + k[1] + '”');
  }
  const e = expr(); if (i < t.length) throw new Error('Unexpected “' + t[i][1] + '”');
  return (vals, today) => { try { const r = e({ ...vals, __today: today }); return typeof r === 'number' && !Number.isFinite(r) ? null : r; } catch { return null; } };
}
export function evalFormula(src, vals, today) { return compile(src)(vals, today); }

export function rollup(kind, items, field, isDone = () => false) {
  const vals = items.map(i => i[field]).filter(v => v != null && v !== '' && !Number.isNaN(+v)).map(Number);
  switch (kind) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'avg': return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    case 'min': return vals.length ? Math.min(...vals) : null;
    case 'max': return vals.length ? Math.max(...vals) : null;
    case 'count': return items.length;
    case 'done': return items.filter(isDone).length;
    case 'percentDone': return items.length ? Math.round(items.filter(isDone).length / items.length * 100) : null;
  }
  return null;
}
