import { h } from '../util.js';
import { empty } from '../ui.js';
export default function render(el) { el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'people')), empty('notes', 'Coming up', 'This page is on the build list.')); }
