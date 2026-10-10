// Natural-language capture parser: pure, offline, no AI needed. Tested in tests/test_nlp.mjs.
import { addDays, addMonths, dow, today as todayStr, timeIn } from './util.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dayIdx = w => DAYS.findIndex(d => d.startsWith(w.slice(0, 3)) && (w.length <= d.length) && d.startsWith(w));
const monIdx = w => MONTHS.indexOf(w.slice(0, 3));
const DAYRE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONRE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const nextDow = (from, target, forceNext) => { let n = (target - dow(from) + 7) % 7; if (n === 0 && forceNext) n = 7; return addDays(from, n); };
const nextDowStrict = (from, target) => addDays(from, ((target - dow(from) + 6) % 7) + 1);

export function parse(input, opt = {}) {
  const now = opt.now || todayStr();
  const nowHM = opt.nowHM || timeIn();
  let s = ' ' + input.trim() + ' ';
  const out = { title: '', due: null, time: null, recur: null, ctx: null, tags: [], priority: null, project: null, chips: [] };
  const take = (re, fn) => { const m = re.exec(s); if (!m) return false; s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); fn(m); return true; };
  const chip = (label, kind) => out.chips.push({ label, kind });

  // tokens: #tag @ctx !prio +project
  while (take(/\s#([\w-]+)/, m => { out.tags.push(m[1].toLowerCase()); chip('#' + m[1], 'tag'); }));
  take(/\s@([\w-]+)/, m => { const c = m[1].toLowerCase(); out.ctx = c === 'outside' || c === 'workoutside' ? 'work-outside-work' : c; chip('@' + out.ctx, 'ctx'); });
  take(/\s!(urgent|high|med|medium|low|[1-4])\b/i, m => { const v = m[1].toLowerCase(); out.priority = { urgent: 1, high: 2, med: 3, medium: 3, low: 4 }[v] || +v; chip('!' + v, 'prio'); });
  take(/\s\+(?:"([^"]+)"|([\w][\w-]*))/, m => { out.project = (m[1] || m[2]).replace(/-/g, ' '); chip('+' + out.project, 'project'); });

  // recurrence (before dates so "every monday" is not read as a one-off date)
  const rec = r => { out.recur = r; chip('repeats ' + recLabel(r), 'recur'); };
  const afterDone = /\s+(?:after|once)\s+(?:completion|done|complete|finished)\b/i;
  const ad = afterDone.test(s); if (ad) s = s.replace(afterDone, ' ');
  if (!take(/\severy\s+(\d+)\s*(day|week|month|year)s?\b/i, m => rec({ freq: m[2].toLowerCase(), interval: +m[1], after: ad }))
    && !take(/\severy\s+weekday\b/i, () => rec({ freq: 'week', interval: 1, byday: [1, 2, 3, 4, 5] }))
    && !take(/\severy\s+weekend\b/i, () => rec({ freq: 'week', interval: 1, byday: [6, 0] }))
    && !take(new RegExp(`\\severy\\s+${DAYRE}(?:\\s*(?:and|,)\\s*${DAYRE})*\\b`, 'i'), m => {
      const days = [...m[0].matchAll(new RegExp(DAYRE, 'gi'))].map(x => dayIdx(x[1].toLowerCase())); rec({ freq: 'week', interval: 1, byday: days }); if (!out.due) out.due = nextDow(now, days[0]); })
    && !take(/\s(?:every\s+)?(daily|weekly|monthly|yearly|annually)\b/i, m => rec({ freq: { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' }[m[1].toLowerCase()], interval: 1, after: ad }))
    && !take(/\severy\s+(day|week|month|year)\b/i, m => rec({ freq: m[1].toLowerCase(), interval: 1, after: ad })));

  // time
  const setTime = (H, M, label) => { out.time = String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0'); chip(label || out.time, 'time'); };
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, m => { let H = +m[1] % 12; if (m[3].toLowerCase() === 'pm') H += 12; setTime(H, +(m[2] || 0)); })
    || take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, m => setTime(+m[1], +m[2]))
    || take(/\sat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|days?|weeks?))/i, m => { let H = +m[1]; if (H < 7) H += 12; setTime(H, 0); })
    || take(/\s(noon|midday)\b/i, () => setTime(12, 0))
    || take(/\s(midnight)\b/i, () => setTime(0, 0))
    || take(/\s(tonight)\b/i, () => { out.due = now; setTime(20, 0); })
    || take(/\s(?:this\s+)?(morning)\b/i, () => setTime(9, 0, 'morning'))
    || take(/\s(?:this\s+)?(afternoon)\b/i, () => setTime(15, 0, 'afternoon'))
    || take(/\s(?:this\s+)?(evening)\b/i, () => setTime(18, 0, 'evening'));
  // relative durations "in 2 hours"
  take(/\sin\s+(\d+)\s*(min(?:ute)?s?|m|hours?|hrs?|h)\b/i, m => {
    const base = new Date(`${now}T${nowHM}:00Z`), add = /^m/i.test(m[2]) ? +m[1] : +m[1] * 60; const d = new Date(base.getTime() + add * 60000);
    out.due = d.toISOString().slice(0, 10); setTime(d.getUTCHours(), d.getUTCMinutes()); });

  // dates
  const dchip = () => chip(out.due, 'date');
  const setDue = d => { out.due = d; };
  if (!out.due || true) {
    (take(/\s(today)\b/i, () => setDue(now)) ||
      take(/\s(tmrw|tomorrow|tmr)\b/i, () => setDue(addDays(now, 1))) ||
      take(/\sday after tomorrow\b/i, () => setDue(addDays(now, 2))) ||
      take(/\sin\s+(\d+)\s*(day|week|month|year)s?\b/i, m => setDue(m[2] === 'day' ? addDays(now, +m[1]) : m[2] === 'week' ? addDays(now, 7 * +m[1]) : m[2] === 'month' ? addMonths(now, +m[1]) : addMonths(now, 12 * +m[1]))) ||
      take(/\snext\s+week\b/i, () => setDue(nextDowStrict(now, 1))) ||
      take(/\snext\s+month\b/i, () => setDue(addMonths(now, 1).slice(0, 8) + '01')) ||
      take(/\send of (?:the )?month\b/i, () => setDue(addDays(addMonths(now.slice(0, 8) + '01', 1), -1))) ||
      take(new RegExp(`\\s(?:next|this|on)?\\s*${DAYRE}\\b`, 'i'), m => { const nx = /next/i.test(m[0]); const t = dayIdx(m[1].toLowerCase()); setDue(nx ? addDays(nextDow(now, t, true), 0) : nextDow(now, t, false)); }) ||
      take(/\s(\d{4})-(\d{2})-(\d{2})\b/, m => setDue(`${m[1]}-${m[2]}-${m[3]}`)) ||
      take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONRE}(?:\\s+(\\d{4}))?\\b`, 'i'), m => setDue(mk(now, +m[1], monIdx(m[2].toLowerCase()), m[3]))) ||
      take(new RegExp(`\\s(?:on\\s+)?${MONRE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`, 'i'), m => setDue(mk(now, +m[2], monIdx(m[1].toLowerCase()), m[3]))) ||
      take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, m => setDue(mk(now, +m[1], +m[2] - 1, m[3] && (m[3].length === 2 ? '20' + m[3] : m[3])))));
  }
  if (out.due) dchip();
  if (out.time && !out.due && !out.recur) { out.due = out.time <= nowHM ? addDays(now, 1) : now; dchip(); }
  if (out.time && !out.due && out.recur) out.due = now;
  if (out.recur && !out.due) out.due = out.recur.byday ? nextDow(now, out.recur.byday[0]) : now;

  out.title = s.replace(/\s+(on|at|by|due|remind me to|remind me|for)\s*$/i, ' ').replace(/^\s*(remind me to|remind me|todo:?)\s+/i, '').replace(/\s+/g, ' ').trim();
  if (out.title) out.title = out.title[0].toUpperCase() + out.title.slice(1);
  return out;
}
function mk(now, d, m, y) { // day/month with optional year; rolls forward to the next occurrence if year omitted
  let yr = y ? +y : +now.slice(0, 4);
  const f = yr => `${yr}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!y && f(yr) < now) yr++; return f(yr);
}
export function recLabel(r) {
  if (!r) return '';
  if (r.byday) { const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; if (r.byday.length === 5 && !r.byday.includes(0) && !r.byday.includes(6)) return 'every weekday'; return 'every ' + r.byday.map(i => n[i]).join(', '); }
  return (r.interval > 1 ? `every ${r.interval} ${r.freq}s` : r.freq === 'day' ? 'daily' : r.freq + 'ly') + (r.after ? ' after done' : '');
}
