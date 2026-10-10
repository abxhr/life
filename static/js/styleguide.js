const r = document.documentElement, set = t => { t === 'system' ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', t); };
document.querySelectorAll('#th button').forEach(b => b.addEventListener('click', () => set(b.dataset.t)));
const sw = document.getElementById('sw');
['paper', 'panel', 'ink', 'ink-2', 'pen', 'margin', 'good', 'bad', 'warn', 'sticky', 'd-travel', 'd-health', 'd-work', 'd-goals', 'd-notes', 'd-lists'].forEach(n => { const d = document.createElement('div'); d.style.cssText = `width:84px;text-align:center;font-size:.85rem`; d.innerHTML = `<div style="height:40px;border:1px solid var(--ink-3);background:var(--${n})"></div>${n}`; sw.append(d); });
