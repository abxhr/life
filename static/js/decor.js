// Page icons & covers: make a note / list / trip / goal feel like yours. Icons are emoji you choose (your own content); covers are paper-tone colours or a photo.
import { h } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast } from './ui.js';

const EMOJI = '📓 📝 📌 ⭐ 💡 🎯 🌱 🔥 ❤️ 🧠 📚 🎬 🎵 🍝 🍕 🍣 ☕ 🍷 🛒 🎁 ✈️ 🧳 🏖️ ⛰️ 🏙️ 🗺️ 🏠 🚗 🔧 💰 📈 💼 📞 📅 ⏰ 🏃 🧘 🏋️ ⚽ 🎾 🏓 🎳 🏎️ 🧩 🎮 🌧️ ☀️ 🌙 🐶 🐱 🌸 🌿 🧾 🩺 💊 🛂 🎓 🔑'.split(' ');
const COVERS = ['#d9c9a3', '#c9d8c5', '#c7d3e3', '#e3c9c9', '#d8cfe6', '#e8d9a8', '#b8c9c9', '#2c3a55'];
export const coverStyle = c => !c ? null : c.file ? { backgroundImage: `url(/api/files/${c.file})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: c.color };

export function coverStrip(rec, { tall } = {}) { return rec && rec.cover ? h('div', { class: 'cover', style: { ...coverStyle(rec.cover), height: tall ? '120px' : '64px' } }) : ''; }
export const iconSpan = rec => rec && rec.icon ? h('span', { class: 'pg-icon', 'aria-hidden': 'true' }, rec.icon) : '';

export function decorDialog(rec, onDone) {
  modal((d, close) => {
    const cur = { icon: rec.icon || '', cover: rec.cover || null };
    const prev = h('div', { class: 'cover', style: { height: '56px', ...(coverStyle(cur.cover) || { background: 'var(--panel-2)' }) } });
    const emoji = h('input', { class: 'in', value: cur.icon, maxlength: 4, placeholder: 'Type or paste an emoji', style: { maxWidth: '200px' }, 'aria-label': 'Icon', oninput: e => cur.icon = e.target.value.trim() });
    const grid = h('div', { class: 'emoji-grid' }, EMOJI.map(e => h('button', { class: 'emoji', type: 'button', 'aria-label': e, onclick: () => { cur.icon = e; emoji.value = e; } }, e)));
    const paintCover = () => { Object.assign(prev.style, { background: '', backgroundImage: '', ...(coverStyle(cur.cover) || { background: 'var(--panel-2)' }) }); };
    const swatches = h('div', { class: 'row wrap' }, h('button', { class: 'chip', onclick: () => { cur.cover = null; paintCover(); } }, 'None'), COVERS.map(c => h('button', { class: 'swatch', 'aria-label': 'Cover ' + c, style: { background: c }, onclick: () => { cur.cover = { color: c }; paintCover(); } })));
    const up = h('input', { type: 'file', accept: 'image/*', class: 'hide', onchange: async () => { const fd = new FormData(); fd.append('file', up.files[0]); try { const r = await store.upload('/api/files', fd); cur.cover = { file: r.id }; paintCover(); } catch (e) { toast(e.message); } } });
    d.append(h('h2', {}, 'Icon & cover'), h('div', { class: 'stack' }, prev, h('div', { class: 'row' }, emoji, h('button', { class: 'btn sm ghost', onclick: () => { cur.icon = ''; emoji.value = ''; } }, 'Clear')), grid, swatches, h('div', {}, h('button', { class: 'btn sm', onclick: () => up.click() }, icon('upload'), 'Use a photo'), up)),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { store.put(rec.kind, { icon: cur.icon || null, cover: cur.cover || null }, rec.id); close(); onDone && onDone(); } }, 'Save')));
  }, { wide: true, label: 'Icon and cover' });
}
