// Local-first store: IndexedDB working copy + outbox, synced to the server (source of truth).
// Every record: {id, kind, created_at, updated_at, deleted_at, ...fields, _t:{field:iso}}
import { uid, nowIso } from './util.js';

const recs = new Map();           // id -> record (flat)
const outbox = new Map();         // id -> {id, kind, data, created_at, updated_at, deleted_at?, v}
const subs = new Set();
let idb = null, since = '', csrf = '', ver = 0, syncing = false, lastSync = null, lastErr = '';

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('life', 1);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('records', { keyPath: 'id' }); d.createObjectStore('outbox', { keyPath: 'id' }); d.createObjectStore('meta'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = (store, mode, fn) => new Promise(res => { try { const t = idb.transaction(store, mode); fn(t.objectStore(store)); t.oncomplete = () => res(); t.onerror = () => res(); } catch { res(); } });
const all = store => new Promise(res => { try { const q = idb.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); } catch { res([]); } });

const flat = r => ({ ...r.data, id: r.id, kind: r.kind, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at });
const notify = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });

export const store = {
  setCsrf(t) { csrf = t; },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  async init() {
    try { idb = await open(); } catch { idb = null; }
    if (idb) {
      for (const r of await all('records')) recs.set(r.id, r);
      for (const o of await all('outbox')) outbox.set(o.id, o);
      since = await new Promise(res => { try { const q = idb.transaction('meta').objectStore('meta').get('since'); q.onsuccess = () => res(q.result || ''); q.onerror = () => res(''); } catch { res(''); } });
    }
    notify();
  },
  pending: () => outbox.size,
  status: () => ({ pending: outbox.size, lastSync, lastErr, syncing }),
  get: id => { const r = recs.get(id); return r && !r.deleted_at ? flat(r) : null; },
  getAny: id => { const r = recs.get(id); return r ? flat(r) : null; },
  list(kind, pred) {
    const out = [];
    for (const r of recs.values()) if (r.kind === kind && !r.deleted_at) { const f = flat(r); if (!pred || pred(f)) out.push(f); }
    return out;
  },
  deletedList: kind => [...recs.values()].filter(r => r.kind === kind && r.deleted_at).map(flat),
  put(kind, patch, id) {
    const t = nowIso(); id = id || patch.id || uid();
    const cur = recs.get(id);
    const data = { ...(cur ? cur.data : {}) }, ft = { ...(data._t || {}) }, delta = { _t: {} };
    for (const [k, v] of Object.entries(patch)) {
      if (['id', 'kind', 'created_at', 'updated_at', 'deleted_at', '_t'].includes(k)) continue;
      if (JSON.stringify(data[k]) === JSON.stringify(v) && cur) continue;
      data[k] = v; ft[k] = t; delta[k] = v; delta._t[k] = t;
    }
    data._t = ft;
    const rec = { id, kind, data, created_at: cur ? cur.created_at : t, updated_at: t, deleted_at: cur ? cur.deleted_at : null };
    recs.set(id, rec);
    this._queue(id, kind, delta, rec);
    notify();
    return flat(rec);
  },
  del(id) { const r = recs.get(id); if (!r) return; r.deleted_at = nowIso(); r.updated_at = r.deleted_at; this._queue(id, r.kind, { _t: {} }, r, true); notify(); },
  restore(id) { const r = recs.get(id); if (!r) return; r.deleted_at = null; r.updated_at = nowIso(); this._queue(id, r.kind, { _t: {} }, r, true); notify(); },
  _queue(id, kind, delta, rec, withDel) {
    const o = outbox.get(id) || { id, kind, data: { _t: {} }, created_at: rec.created_at };
    Object.assign(o.data, delta, { _t: { ...o.data._t, ...delta._t } });
    o.updated_at = rec.updated_at; if (withDel) o.deleted_at = rec.deleted_at; o.v = ++ver;
    outbox.set(id, o);
    if (idb) { tx('records', 'readwrite', s => s.put(rec)); tx('outbox', 'readwrite', s => s.put(o)); }
    this.syncSoon();
  },
  _t: 0, syncSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.sync(), 600); },
  async api(path, opt = {}) {
    const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf, ...(opt.headers || {}) }, credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); throw new Error('auth'); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status }); return j;
  },
  async stream(path, body, onEvent) { // SSE over fetch (POST): calls onEvent for each JSON event; resolves when the stream ends
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(body), credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* partial */ } } } }
  },
  async upload(path, fd) {
    const r = await fetch(path, { method: 'POST', body: fd, headers: { 'X-CSRF': csrf }, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
  async sync() {
    if (syncing || !navigator.onLine) return; syncing = true; notify();
    try {
      if (!csrf) { const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json(); if (!me.authed) { location.reload(); return; } csrf = me.csrf; }   // came back online after an offline start
      const batch = [...outbox.values()].slice(0, 200);
      if (batch.length) {
        const j = await this.api('/api/sync', { method: 'POST', body: JSON.stringify({ changes: batch.map(({ v, ...c }) => c) }) });
        for (const b of batch) { const o = outbox.get(b.id); if (o && o.v === b.v) { outbox.delete(b.id); if (idb) tx('outbox', 'readwrite', s => s.delete(b.id)); } }
        this._absorb(j.records);
      }
      let more = true;
      while (more) {
        const j = await this.api('/api/sync?since=' + encodeURIComponent(since));
        this._absorb(j.records); more = j.more;
        if (j.records.length) since = j.records[j.records.length - 1].updated_at; else since = since || j.now;
        if (idb) tx('meta', 'readwrite', s => s.put(since, 'since'));
      }
      lastSync = new Date().toISOString(); lastErr = '';
    } catch (e) { lastErr = e.message || 'offline'; }
    syncing = false; notify();
    if (outbox.size && !lastErr) this.syncSoon();
  },
  _absorb(list) {
    for (const r of list) {
      const pend = outbox.get(r.id);
      let rec = { id: r.id, kind: r.kind, data: r.data, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at };
      if (pend) { // keep unsynced local edits on top of the server copy
        rec.data = { ...r.data, ...Object.fromEntries(Object.keys(pend.data).filter(k => k !== '_t').map(k => [k, pend.data[k]])) };
        if (pend.deleted_at) rec.deleted_at = pend.deleted_at;
      }
      recs.set(r.id, rec);
      if (idb) tx('records', 'readwrite', s => s.put(rec));
    }
    if (list.length) notify();
  },
  async wipeLocal() { recs.clear(); outbox.clear(); since = ''; if (idb) { await tx('records', 'readwrite', s => s.clear()); await tx('outbox', 'readwrite', s => s.clear()); await tx('meta', 'readwrite', s => s.clear()); } },
};
window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) store.sync(); });
setInterval(() => { if (!document.hidden) store.sync(); }, 30000);
