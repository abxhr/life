// Phone side of the QR hand-off. Chunk format (written by work-capture.js): LC1:<crc32>:<i>:<n>:<base64url chunk>.
// Payload = JSON {v:1, items:[{id, t}]}; crc32 of the payload doubles as the set id, so repeat scans are no-ops.
import { crc32 } from './crc.js';

const un64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new TextDecoder().decode(u); };

export function makeCollector() {
  const sets = {};
  return {
    // returns {state:'partial', have, need} | {state:'done', items} | {state:'bad'}
    add(text) {
      const m = /^LC1:([0-9a-f]{8}):(\d+):(\d+):([\w-]+)$/.exec(text.trim()); if (!m) return { state: 'bad' };
      const [, set, i, n, data] = m; const s = (sets[set] ||= { n: +n, parts: {} }); s.parts[+i] = data;
      const have = Object.keys(s.parts).length; if (have < s.n) return { state: 'partial', have, need: s.n, set };
      let payload; try { payload = un64(Array.from({ length: s.n }, (_, k) => s.parts[k + 1]).join('')); } catch { return { state: 'bad' }; }
      if (crc32(payload) !== set) return { state: 'bad', reason: 'checksum' };
      try { const j = JSON.parse(payload); return { state: 'done', set, items: j.items || [] }; } catch { return { state: 'bad' }; }
    },
  };
}
// deterministic id from text so a repeat import can never create a duplicate
export async function itemId(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('work:' + text.trim().toLowerCase()));
  const h = [...new Uint8Array(d)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const linesFromText = t => t.split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, '').trim()).filter(Boolean);
