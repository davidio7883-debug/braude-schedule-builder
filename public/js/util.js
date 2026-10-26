export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);

/** Stable hue per course id, spread around the color wheel. */
export const hueOf = id => (Number(id) * 137.508) % 360;

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
