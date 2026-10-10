// One consistent line-icon set (24px grid, 1.7 stroke, round caps). No emoji as icons.
const P = {
  today: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M8 14h3',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  tasks: 'M5 4h14v16H5zM9 9l2 2 4-4M9 15h6',
  calendar: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M8 14h2M12 14h2M8 17h2',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  lists: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  goals: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 13a1 1 0 100-2 1 1 0 000 2z',
  travel: 'M3 20h18M5 16l-1-5 3 1 4-7 2 1-2 7 5 1 3-3 1 1-2 5z',
  health: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11zM8 11h2l1.5-3 2 6 1.5-3h1',
  assistant: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  review: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2 1-1 3-2.3-.4a7 7 0 01-1.6 1.3L15 20h-3.5l-.6-2.4a7 7 0 01-1.7-1.3L7 16l-1.8-2.7 1.8-1.7a7 7 0 010-1.8L5.2 8.2 7 5.5l2.2.7a7 7 0 011.7-1.3L11.5 3H15l.4 2.4a7 7 0 011.6 1.3L19.3 6l1.2 2.9-1.8 1.4c.1.6.1 1.1 0 1.7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14', check: 'M5 13l4 4L19 7', x: 'M6 6l12 12M18 6L6 18', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', repeat: 'M4 12V9a3 3 0 013-3h11M15 3l3 3-3 3M20 12v3a3 3 0 01-3 3H6M9 21l-3-3 3-3',
  flag: 'M5 21V4h12l-2 4 2 4H5', mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14A8 8 0 1110 4a6.5 6.5 0 0010 10z', briefcase: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18', home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', pin: 'M12 21s6-6 6-11a6 6 0 00-12 0c0 5 6 11 6 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  chevL: 'M15 5l-7 7 7 7', chevR: 'M9 5l7 7-7 7', chevD: 'M5 9l7 7 7-7', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  refresh: 'M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z', send: 'M3 11l18-8-8 18-2-8z', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  dish: 'M4 14a8 8 0 0116 0zM2 18h20M12 6V4', ball: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3c3 3 3 15 0 18M3 12c3 3 15 3 18 0', book: 'M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2zM5 18a2 2 0 012-2h12', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z', zap: 'M13 3L5 14h6l-1 7 8-11h-6z',
  menu: 'M4 7h16M4 12h16M4 17h16', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01', dots: 'M12 5h.01M12 12h.01M12 19h.01', copy: 'M8 8h12v12H8zM4 16V4h12', shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z', smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 14a5 5 0 008 0M9 9.5h.01M15 9.5h.01',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.more); s.append(p); return s;
}
export const iconNames = Object.keys(P);
