// 简洁线性图标（currentColor），用于 UI 与地图标签
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  bread: svg('<path d="M5 11c-1.5-.5-2-2-1-3.5C5.5 5 9 4 12 4s6.5 1 8 3.5c1 1.5.5 3-1 3.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M9 9v3M12 8v4M15 9v3"/>'),
  soup: svg('<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1.5 1-1.5 1-3M12 7c0-1.5 1-1.5 1-3M16 7c0-1.5 1-1.5 1-3"/>'),
  grocery: svg('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M10 13c1 1 3 1 4 0"/>'),
  paw: svg('<circle cx="7" cy="10" r="1.8"/><circle cx="11" cy="6.5" r="1.8"/><circle cx="15.5" cy="7" r="1.8"/><circle cx="18" cy="11" r="1.8"/><path d="M8.5 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2.5-4 2.5s-4-.5-4-2.5z"/>'),
  door: svg('<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M4 21h16"/><circle cx="14.5" cy="12" r=".8" fill="currentColor"/>'),
  box: svg('<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v9l9 4 9-4V8"/><path d="M12 12v9"/>'),
  bird: svg('<path d="M16 7a3 3 0 0 0-5 2c0 3-3 6-8 6 2 2 5 3 8 3a7 7 0 0 0 7-7V9l2-1-2-1"/><circle cx="15.5" cy="8" r=".6" fill="currentColor"/>'),
  fish: svg('<path d="M3 12c3-4 7-5 10-5s5 2 7 5c-2 3-4 5-7 5s-7-1-10-5z"/><path d="M3 12l-1-3M3 12l-1 3"/><circle cx="15" cy="11" r=".8" fill="currentColor"/>'),
  hand: svg('<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15l-1-3a1.5 1.5 0 0 1 2.6-1.4L8 13"/>'),
  rain: svg('<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 0 7z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
  coin: svg('<ellipse cx="12" cy="12" rx="8" ry="8"/><path d="M8 12c1.5-2 3-2.5 4.5-2.5S15 10.5 16 12c-1 1.5-2 2.5-3.5 2.5S9.5 14 8 12z"/>'),
  snack: svg('<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M4 12h16"/><path d="M8 8l1-3h6l1 3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
  bolt: svg('<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'),
  check: svg('<path d="M5 12l4 4 10-10"/>'),
  heart: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
  store: svg('<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0z"/><path d="M5 12v8h14v-8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  target: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  note: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  turn: svg('<path d="M5 20v-7a4 4 0 0 1 4-4h10"/><path d="M15 5l4 4-4 4"/>'),
  jar: svg('<rect x="6" y="7" width="12" height="13" rx="2"/><path d="M7 4h10v3H7z"/><path d="M9 13c1-1 2-1.5 3-1.5s2 .5 3 1.5c-1 1-2 1.5-3 1.5S10 14 9 13z"/>'),
  raincoat: svg('<path d="M12 3c-4 0-6 3-6 6v11h12V9c0-3-2-6-6-6z"/><path d="M9 9a3 3 0 0 1 6 0"/>'),
  bed: svg('<path d="M3 18v-5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5"/><path d="M3 15h18M3 18v2M21 18v2"/><path d="M7 10V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>'),
  desk: svg('<path d="M3 9h18M5 9v11M19 9v11M5 14h14"/><path d="M8 9V5h8v4"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.5"/>'),
};

export const GOODS_ICON = { bread: ICONS.bread, soup: ICONS.soup, grocery: ICONS.grocery };
export const EVENT_ICON = { box: ICONS.box, bird: ICONS.bird, fish: ICONS.fish, touch: ICONS.hand, rain: ICONS.rain, stay: ICONS.heart };
