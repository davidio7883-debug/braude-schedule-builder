export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);

/** Stable hue per course id, spread around the color wheel. */
export const hueOf = id => (Number(id) * 137.508) % 360;

/** Accessible course colors (all keep ≥4.5:1 text contrast with the block styles in light and dark mode). */
export const PALETTE = ['#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#0d9488', '#0891b2', '#64748b'];

/** Relative luminance of a #rrggbb color (0 = black, 1 = white). */
export function luminance(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return 0.2;
  const [r, g, b] = m.slice(1).map(x => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

let toastTimer;
export function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 7000 : 3200);
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const YEDION = 'https://info.braude.ac.il/yedion/fireflyweb.aspx';

/**
 * Opens a yedion page for the right academic year. The yedion keeps the year in a server session,
 * so we first POST the year switch into a new tab (setting its session cookie), then navigate that tab.
 */
export function openOfficial(year, prgname, args) {
  const target = `braude_${Date.now()}`;
  const win = window.open('', target);
  if (!win) {
    toast('הדפדפן חסם פתיחת לשונית חדשה – אפשרו חלונות קופצים לאתר זה ונסו שוב');
    return;
  }
  try {
    win.document.write('<p dir="rtl" style="font-family:sans-serif;padding:2em">פותח את אתר המכללה…</p>');
  } catch {}
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = YEDION;
  form.target = target;
  for (const [k, v] of Object.entries({ PRGNAME: 'Enter_Search', ARGUMENTS: '-A,,-A,ChangeYear', ChangeYear: String(year) })) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = k; input.value = v;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  form.remove();
  setTimeout(() => {
    try { win.location.href = `${YEDION}?prgname=${prgname}&arguments=${args}`; } catch {}
  }, 2200);
}
