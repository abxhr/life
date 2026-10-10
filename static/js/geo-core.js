// Distance + "near a place" matching (pure; unit-tested).
export const metres = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon), h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
export function nearbyDue(pos, tasks, doneToday) { return tasks.filter(t => t.near && !t.done && !doneToday.has(t.id) && metres(pos, t.near) <= (t.near.radius || 300)); }
