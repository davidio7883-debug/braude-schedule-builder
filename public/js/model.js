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
 * Narrows the groups of one type by the links of the groups already picked.
 * Links ("קבוצות הקשורות" / "תנאי קשר") can come from any group and form chains, e.g. in 61903 the lecture
 * names its tutorials and each tutorial names its labs. A picked group that links some groups of this type
 * requires one of them.
 */
function constrain(course, typeGroups, picks) {
  let allowed = typeGroups;
  for (const iid of Object.values(picks ?? {})) {
    const picked = iid && course.groups.find(g => g.iid === iid);
    if (!picked || picked.typeCode === typeGroups[0]?.typeCode) continue;
    const linked = allowed.filter(g => picked.links.includes(g.iid));
    if (linked.length) allowed = linked;
    else if (typeGroups.some(g => picked.links.includes(g.iid))) allowed = [];
  }
  return allowed;
}

/** Allowed groups of one type given the other picks; falls back to all groups of the type if picks conflict. */
export function allowedGroups(course, sem, typeCode, picks) {
  const type = groupTypes(course, sem).find(t => t.code === typeCode);
  if (!type) return [];
  const others = Object.fromEntries(Object.entries(picks ?? {}).filter(([code]) => code !== typeCode));
  const allowed = constrain(course, type.groups, others);
  return allowed.length ? allowed : type.groups;
}

/** True if every link of every picked group is satisfied by the other picks. */
function consistent(course, picks) {
  const picked = Object.values(picks).map(iid => course.groups.find(g => g.iid === iid));
  return picked.every(p => picked.every(q => q === p || q.typeCode === p.typeCode ||
    !course.groups.some(g => g.typeCode === q.typeCode && p.links.includes(g.iid)) || p.links.includes(q.iid)));
}

/**
 * Every valid combination of groups for a course (one per required type), collapsed by identical time slots.
 * options: [{ picks: {typeCode: iid}, slots: [[day, start, end, typeCode]], full, selfOverlap, alternatives }]
 */
export function courseOptions(course, sem, { excludedTypes = [], locked = {}, avoidFull = false } = {}, cap = 20000) {
  const types = groupTypes(course, sem).filter(t => !excludedTypes.includes(t.code));
  const byIid = new Map(course.groups.map(g => [g.iid, g]));
  const pickable = (code, groups) => {
    let gs = locked[code] ? groups.filter(g => g.iid === locked[code]) : groups;
    if (avoidFull) {
      const open = gs.filter(g => !g.full);
      if (open.length) gs = open;
    }
    return gs;
  };
  // Pick link sources before their targets: lecture first, then types whose groups carry links.
  const hasLinks = t => t.groups.some(g => g.links.length);
  const order = types.slice().sort((a, b) =>
    (a.code === LECTURE ? 0 : hasLinks(a) ? 1 : 2) - (b.code === LECTURE ? 0 : hasLinks(b) ? 1 : 2));
  const rows = order.length ? [order] : [];

  const bySig = new Map();
  let count = 0;
  for (const row of rows) {
    const walk = (k, picks) => {
      if (count >= cap) return;
      if (k === row.length) {
        if (!consistent(course, picks)) return;
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
      const type = row[k];
      for (const g of pickable(type.code, constrain(course, type.groups, picks))) {
        picks[type.code] = g.iid;
        walk(k + 1, picks);
      }
      delete picks[type.code];
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

/**
 * The groups a student can register to. Like the official registration system, a student only gets the groups
 * of their own degree's cohort: per group type, the own-degree groups (plus tutorials/labs linked from groups
 * already allowed), else shared-cohort groups, else everything – the latter two are reported in noDedicated.
 * Groups the student marked "not available to me" (hidden) are dropped unless that would empty a type.
 * opts: { degree, degreeOf(group) -> degree code | null, showOther, hidden: [iid] }
 * Returns the course with only those groups (other semesters untouched), plus noDedicated: [type names].
 */
export function eligibleCourse(course, sem, { degree, degreeOf, showOther = false, hidden = [] } = {}) {
  const hide = new Set(hidden);
  const keep = new Set(course.groups.filter(g => g.sem !== sem && !g.sessions.some(s => s.sem === sem)));
  const noDedicated = [];
  const rank = t => (t.code === LECTURE ? 0 : t.groups.some(g => g.links.length) ? 1 : 2);
  for (const t of groupTypes(course, sem).sort((a, b) => rank(a) - rank(b))) {
    let gs = t.groups;
    if (degree && !showOther) {
      const own = gs.filter(g => degreeOf(g) === degree);
      const linked = gs.filter(g => [...keep].some(k => k.links.includes(g.iid)));
      const shared = gs.filter(g => !degreeOf(g));
      if (own.length) gs = [...new Set([...own, ...linked])];
      else if (linked.length) gs = linked;
      else { gs = shared.length ? shared : gs; noDedicated.push(t.name); }
    }
    const visible = gs.filter(g => !hide.has(g.iid));
    for (const g of visible.length ? visible : gs) keep.add(g);
  }
  return { ...course, groups: course.groups.filter(g => keep.has(g)), noDedicated };
}
