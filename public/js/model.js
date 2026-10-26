// Data model helpers shared by the UI, the worker and the Node tests.

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
export const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
export const LECTURE = '1';
/** PBL sessions run inside the course's own lecture hours (e.g. 51104), so they may overlap their own course. */
export const PBL = '21';

/** Same-course overlap that the college schedules on purpose: a PBL session with another session of its course. */
export const allowedSelfOverlap = (typeA, typeB) => typeA === PBL || typeB === PBL;

/** slots: [[day, start, end, typeCode]] – true if two of the course's own sessions clash. */
export const overlapsItself = slots => slots.some((a, i) => slots.some((b, j) =>
  j > i && a[0] === b[0] && a[1] < b[2] && b[1] < a[2] && !allowedSelfOverlap(a[3], b[3])));

export const toMin = t => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Time range wrapped in LTR isolates so it reads correctly inside Hebrew text (also inside <option>). */
export const range = (a, b) => `⁦${a}–${b}⁩`;

export const fmtHours = mins => {
  const h = mins / 60;
  return Number.isInteger(h) ? `${h}` : h.toFixed(1);
};

/** Groups of a course that run in the given semester (instance semester or any session in it). */
export function semesterGroups(course, sem) {
  return course.groups.filter(g => g.sem === sem || g.sessions.some(s => s.sem === sem));
}

export const semesterSessions = (group, sem) => group.sessions.filter(s => s.sem === sem);

export function courseInSemester(course, sem) {
  return semesterGroups(course, sem).length > 0;
}

/** Group types (typeCode -> {name, groups}) of a course in a semester, lecture first. */
export function groupTypes(course, sem) {
  const types = new Map();
  for (const g of semesterGroups(course, sem)) {
    if (!types.has(g.typeCode)) types.set(g.typeCode, { code: g.typeCode, name: g.type, groups: [] });
    types.get(g.typeCode).groups.push(g);
  }
  return [...types.values()].sort((a, b) => (a.code === LECTURE ? -1 : b.code === LECTURE ? 1 : a.code.localeCompare(b.code)));
}

/**
 * Allowed groups of each type, given the picks made so far.
 * Rule: one lecture group; for every other type, if the chosen lecture links groups of that type
 * ("קבוצות הקשורות"), one of those must be taken, otherwise any group of that type.
 */
export function allowedGroups(course, sem, typeCode, picks) {
  const types = groupTypes(course, sem);
  const type = types.find(t => t.code === typeCode);
  if (!type) return [];
  if (typeCode === LECTURE) return type.groups;
  const lectureIid = picks?.[LECTURE];
  const lecture = lectureIid && course.groups.find(g => g.iid === lectureIid);
  const linked = lecture ? type.groups.filter(g => lecture.links.includes(g.iid)) : [];
  return linked.length ? linked : type.groups;
}

/**
 * Every valid combination of groups for a course (one per required type), collapsed by identical time slots.
 * options: [{ picks: {typeCode: iid}, slots: [[day, start, end]], full, alternatives }]
 */
export function courseOptions(course, sem, { excludedTypes = [], locked = {}, avoidFull = false } = {}, cap = 20000) {
  const types = groupTypes(course, sem).filter(t => !excludedTypes.includes(t.code));
  const byIid = new Map(course.groups.map(g => [g.iid, g]));
  const lists = []; // per-lecture list of [typeCode, candidates][]
  const lecture = types.find(t => t.code === LECTURE);
  const others = types.filter(t => t.code !== LECTURE);
  const pickable = (code, groups) => {
    let gs = locked[code] ? groups.filter(g => g.iid === locked[code]) : groups;
    if (avoidFull) {
      const open = gs.filter(g => !g.full);
      if (open.length) gs = open;
    }
    return gs;
  };
  if (lecture) {
    for (const L of pickable(LECTURE, lecture.groups)) {
      const row = [[LECTURE, [L]]];
      for (const t of others) {
        const linked = t.groups.filter(g => L.links.includes(g.iid));
        row.push([t.code, pickable(t.code, linked.length ? linked : t.groups)]);
      }
      lists.push(row);
    }
  } else if (others.length) {
    lists.push(others.map(t => [t.code, pickable(t.code, t.groups)]));
  }

  const bySig = new Map();
  let count = 0;
  for (const row of lists) {
    const walk = (k, picks) => {
      if (count >= cap) return;
      if (k === row.length) {
        count++;
        const groups = Object.values(picks).map(iid => byIid.get(iid));
        const slots = groups.flatMap(g => semesterSessions(g, sem).map(s => [s.day, toMin(s.start), toMin(s.end), g.typeCode]))
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const full = groups.some(g => g.full);
        // the course's own groups overlap each other (e.g. lecture + tutorial at the same hour)
        const selfOverlap = overlapsItself(slots);
        const sig = slots.map(s => s.join('-')).join('|');
        const prev = bySig.get(sig);
        if (!prev) bySig.set(sig, { picks: { ...picks }, slots, full, selfOverlap, alternatives: 1 });
        else {
          prev.alternatives++;
          if (prev.full && !full) Object.assign(prev, { picks: { ...picks }, full });
        }
        return;
      }
      const [code, candidates] = row[k];
      for (const g of candidates) {
        picks[code] = g.iid;
        walk(k + 1, picks);
      }
      delete picks[code];
    };
    walk(0, {});
  }
  return [...bySig.values()];
}

/**
 * Clashes among a flat list of placed sessions: returns Set of indexes that overlap another session,
 * including sessions of the same course (e.g. a lecture and a tutorial at the same hour).
 * Only items of a course the user marked "allow overlap" (overlapOk) are exempt.
 */
export function clashIndexes(items) {
  const clash = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.overlapOk || b.overlapOk) continue;
      if (a.courseId === b.courseId && allowedSelfOverlap(a.typeCode, b.typeCode)) continue;
      if (a.day === b.day && a.start < b.end && b.start < a.end) { clash.add(i); clash.add(j); }
    }
  }
  return clash;
}

/** Stats of a schedule given flat slots [[day,start,end]]. */
export function scheduleStats(slots) {
  const perDay = Array.from({ length: 6 }, () => []);
  for (const [d, s, e] of slots) if (d >= 0 && d < 6) perDay[d].push([s, e]);
  let days = 0, busy = 0, gaps = 0, sumSpan = 0, maxSpan = 0, earliest = Infinity, latest = 0;
  const daily = perDay.map(list => {
    if (!list.length) return null;
    list.sort((a, b) => a[0] - b[0]);
    days++;
    let dayBusy = 0, cur = -1;
    for (const [s, e] of list) {
      const from = Math.max(s, cur);
      if (e > from) dayBusy += e - from;
      cur = Math.max(cur, e);
    }
    const start = list[0][0], end = Math.max(...list.map(x => x[1]));
    const span = end - start;
    busy += dayBusy; gaps += span - dayBusy; sumSpan += span; maxSpan = Math.max(maxSpan, span);
    earliest = Math.min(earliest, start); latest = Math.max(latest, end);
    return { start, end, span, busy: dayBusy, gaps: span - dayBusy };
  });
  return { days, busy, gaps, sumSpan, maxSpan, earliest: days ? earliest : null, latest: days ? latest : null, daily };
}
