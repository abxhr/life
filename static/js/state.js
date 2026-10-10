// Small shared UI state (mode, theme, density) kept in localStorage with safe fallbacks.
const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export const state = {
  get mode() { return get('mode', 'all'); },            // all | personal | work
  setMode(m) { set('mode', m); document.dispatchEvent(new Event('modechange')); },
  get theme() { return get('theme', 'system'); },
  setTheme(t) { set('theme', t); applyTheme(); },
  get density() { return get('density', 'comfortable'); },
  setDensity(d) { set('density', d); applyTheme(); },
};
export function applyTheme() {
  const r = document.documentElement, t = state.theme;
  if (t === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  r.setAttribute('data-density', state.density);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#11140f' : '#25304b');
}
export const isWork = x => x && (x.ctx === 'work' || x.ctx === 'work-outside-work' || (x.tags || []).includes('work'));
export const inMode = x => state.mode === 'all' || (state.mode === 'work' ? isWork(x) : !isWork(x));
