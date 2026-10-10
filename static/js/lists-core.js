// Built-in list types: each is a schema (fields) + status flow. Users can add their own types (kind 'list_type').
import { store } from './store.js';

const S = (k, label, options) => ({ k, label, type: 'select', options });
const T = (k, label, type = 'text') => ({ k, label, type });
export const BUILTIN = {
  todo: { name: 'Things to do', icon: 'star', statuses: ['someday', 'planned', 'done'], fields: [S('effort', 'Effort', ['low', 'medium', 'high']), S('cost', 'Cost', ['free', '$', '$$', '$$$']), S('energy', 'Energy', ['low', 'medium', 'high'])] },
  eat: { name: 'Things to eat', icon: 'dish', statuses: ['want to try', 'tried'], fields: [T('cuisine', 'Cuisine'), T('where', 'Where to get it'), T('rating', 'Rating', 'rating')] },
  restaurant: { name: 'Restaurants', icon: 'dish', map: true, statuses: ['want to go', 'been, loved', 'been, meh'], fields: [T('cuisine', 'Cuisine'), T('city', 'City / area'), S('price', 'Price', ['$', '$$', '$$$', '$$$$']), T('with', 'Who with'), T('occasion', 'Occasion'), T('source', 'Who recommended'), T('url', 'Website / maps link', 'url'), T('phone', 'Phone'), T('rating', 'Rating', 'rating')] },
  play: { name: 'Places to play', icon: 'ball', map: true, statuses: ['want to try', 'been', 'regular'], fields: [{ k: 'activity', label: 'Activity', type: 'activity' }, T('venue', 'Venue'), T('area', 'Area'), T('price', 'Price'), T('best_time', 'Best time'), T('with', 'Who with'), T('url', 'Booking link', 'url'), T('phone', 'Phone'), T('rating', 'Rating', 'rating')] },
  media: { name: 'Watch, read, listen', icon: 'book', statuses: ['to try', 'in progress', 'finished'], fields: [S('medium', 'Type', ['movie', 'show', 'book', 'podcast', 'music', 'game']), T('creator', 'By'), T('source', 'Who recommended'), T('rating', 'Rating', 'rating')] },
  gift: { name: 'Gift ideas', icon: 'heart', statuses: ['idea', 'bought', 'given'], fields: [T('person', 'For'), T('price', 'Price', 'number'), T('url', 'Link', 'url'), T('occasion', 'Occasion')] },
  wishlist: { name: 'Wishlist', icon: 'star', statuses: ['wanted', 'bought'], fields: [T('price', 'Price', 'number'), T('target', 'Buy when below', 'number'), T('store', 'Store'), T('url', 'Link', 'url')] },
  grocery: { name: 'Grocery', icon: 'lists', statuses: ['need', 'got'], grouped: 'aisle', fields: [S('aisle', 'Aisle', ['produce', 'dairy', 'meat & fish', 'bakery', 'pantry', 'frozen', 'drinks', 'household', 'other']), T('qty', 'Qty')] },
  packing: { name: 'Packing template', icon: 'lists', statuses: ['to pack', 'packed'], grouped: 'group', fields: [S('group', 'Group', ['documents', 'clothes', 'toiletries', 'tech', 'health', 'misc']), T('qty', 'Qty')] },
  learning: { name: 'Learning & skills', icon: 'book', statuses: ['queued', 'learning', 'done'], fields: [T('kind', 'Kind (course, skill, book)'), T('progress', 'Progress %', 'number'), T('url', 'Link', 'url')] },
  readlater: { name: 'Read later', icon: 'link', statuses: ['to read', 'reading', 'read'], fields: [T('url', 'Link', 'url'), T('minutes', 'Minutes to read', 'number'), T('source', 'From')] },
  ideas: { name: 'Ideas', icon: 'zap', statuses: ['spark', 'exploring', 'parked', 'done'], fields: [] },
};
export const types = () => { const o = { ...BUILTIN }; store.list('list_type').forEach(t => o[t.id] = { name: t.name, icon: 'lists', statuses: t.statuses || ['open', 'done'], fields: t.fields || [], custom: true }); return o; };
export const doneStatus = ty => ty.statuses[ty.statuses.length - 1];
export const isDone = (it, ty) => it.status === doneStatus(ty) || (it.status || '').startsWith('been') || it.status === 'tried';
export function toMarkdown(list, items, ty) {
  const lines = ['# ' + list.name, ''];
  items.forEach(i => { const bits = ty.fields.filter(f => i[f.k] && f.type !== 'rating').map(f => i[f.k]); lines.push(`- [${isDone(i, ty) ? 'x' : ' '}] ${i.title}${bits.length ? ' — ' + bits.join(', ') : ''}${i.rating ? ' ' + '★'.repeat(i.rating) : ''}`); });
  return lines.join('\n');
}
export function distanceKm(a, b) { const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
// accepts "25.2, 55.27", or a Google/Apple/OSM maps URL containing @lat,lon or ?q=lat,lon
export function parseLatLon(s) { const m = /(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/.exec(s || ''); return m ? { lat: +m[1], lon: +m[2] } : null; }
