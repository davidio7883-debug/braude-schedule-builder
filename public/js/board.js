import { DAY_NAMES, fmtMin, range } from './model.js';
import { esc } from './util.js';

const DEFAULT_FROM = 8 * 60;
const DEFAULT_TO = 22 * 60; // grows automatically if a placed session ends later (a few 2027 courses run to 22:50/23:50)

/** Assigns side-by-side lanes to overlapping items of one day. */
function layoutLanes(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex(end => end <= it.start);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.end;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = lanes.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return sorted;
}

function blockHtml(it, from, cls) {
  const top = `calc(${it.start - from} * var(--ppm))`;
  const height = `calc(${it.end - it.start} * var(--ppm) - 2px)`;
  const width = 100 / it.lanes;
  const short = it.end - it.start < 75;
  const tip = `${it.title} · ${it.type}\n${range(fmtMin(it.start), fmtMin(it.end))}${it.room ? ` · ${it.room}` : ''}${it.lecturer ? `\n${it.lecturer}` : ''}${it.full ? '\nהקבוצה מלאה' : ''}`;
  return `<div class="block ${cls}" style="--h:${it.hue};${it.fill ? `--fill:${it.fill};--ink:${it.ink};` : ''}top:${top};height:${height};inset-inline-start:calc(${width * it.lane}% + 2px);width:calc(${width}% - 4px)"
    data-action="${esc(it.action)}" data-course="${it.courseId}" data-iid="${esc(it.iid)}" title="${esc(tip)}">
    <b>${esc(it.title)}</b>
    <div class="t">${esc(it.type)}${it.group ? ` · ${esc(it.group)}` : ''}${it.full ? ' · <span class="full-tag">מלא</span>' : ''}</div>
    ${short ? '' : `<div class="t">${range(fmtMin(it.start), fmtMin(it.end))}</div><div class="t">${esc(it.room || '')}</div>`}
    ${it.pblOk && !it.clash ? `<div class="pbl-note" title="מפגש PBL מתקיים בתוך שעות ההרצאה של אותו קורס – זה מכוון ואינו התנגשות">PBL חופף להרצאה – מותר</div>` : ''}
  </div>`;
}

/**
 * items:  placed sessions {courseId, iid, day, start, end, title, type, group, room, lecturer, full, hue, fill?, ink?, clash, active, action}
 * ghosts: alternative groups of the course being edited (same shape, plus disabled)
 * days:   number of day columns from Sunday (5 hides Friday, 6 shows it)
 */
export function renderBoard(el, { items, ghosts = [], daysOff = [], days = 6 }) {
  el.style.setProperty('--days', days);
  const all = [...items, ...ghosts];
  const from = Math.min(DEFAULT_FROM, ...all.map(i => Math.floor(i.start / 60) * 60));
  const to = Math.max(DEFAULT_TO, ...all.map(i => Math.ceil(i.end / 60) * 60));
  const height = `calc(${to - from} * var(--ppm))`;

  let html = `<div class="board-head"></div>`;
  for (let d = 0; d < days; d++) {
    const n = items.filter(i => i.day === d).length;
    html += `<div class="board-head ${daysOff.includes(d) ? 'off' : ''}">יום ${DAY_NAMES[d]}<small>${n ? `${n} מפגשים` : daysOff.includes(d) ? 'יום חופש' : 'פנוי'}</small></div>`;
  }
  html += `<div class="time-col" style="height:${height}">`;
  for (let m = from + 60; m < to; m += 60) html += `<div class="time-label" style="top:calc(${m - from} * var(--ppm))">${fmtMin(m)}</div>`;
  html += `</div>`;

  for (let d = 0; d < days; d++) {
    html += `<div class="day-col ${daysOff.includes(d) ? 'off' : ''}" style="height:${height}">`;
    for (const it of layoutLanes(items.filter(i => i.day === d))) {
      html += blockHtml(it, from, `${it.fill ? 'custom' : ''} ${it.clash ? 'clash' : ''} ${it.active ? 'active' : ''} ${it.preview ? 'preview' : ''}`);
    }
    for (const it of layoutLanes(ghosts.filter(i => i.day === d))) {
      html += blockHtml(it, from, `ghost ${it.disabled ? 'disabled' : ''}`);
    }
    html += `</div>`;
  }
  el.innerHTML = html;
}
