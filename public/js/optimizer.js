// Automatic timetable builder: branch-and-bound search over each course's group combinations.
// Pure module: runs in a Web Worker (optimizer.worker.js) and in Node tests.
import { scheduleStats } from './model.js';

export const MODES = {
  fewDays:  { label: 'כמה שפחות ימים', days: 12, gaps: 1, span: 0.25, max: 0.25 },
  shortDays:{ label: 'ימים קצרים', days: 0.6, gaps: 1.2, span: 0.3, max: 2.5 },
  compact:  { label: 'בלי חלונות', days: 1.5, gaps: 3, span: 0.3, max: 0.3 },
  balanced: { label: 'איזון', days: 4, gaps: 1.6, span: 0.4, max: 0.8 },
};

export function scoreOf(stats, w) {
  return w.days * 60 * stats.days + w.gaps * stats.gaps + w.span * stats.sumSpan + w.max * stats.maxSpan;
}

/** Union of a course's own sessions per day (the yedion sometimes nests a tutorial inside the lecture slot). */
function mergeSlots(slots) {
  const out = [];
  for (const [d, s, e] of slots.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out[out.length - 1];
    if (last && last[0] === d && s <= last[2]) last[2] = Math.max(last[2], e);
    else out.push([d, s, e]);
  }
  return out;
}

const FULL_PENALTY = 240; // a full group costs as much as ~4 hours of gaps

/**
 * courses: [{ id, name, allowOverlap?, options: [{ picks, slots: [[day, start, end]], full }] }]
 *          allowOverlap: the course may overlap others (e.g. labs that run on alternating weeks)
 * prefs:   { mode, daysOff: number[], earliest: minutes|null, latest: minutes|null, avoidFull, topK }
 */
export function solve(courses, prefs = {}, limits = {}) {
  const w = MODES[prefs.mode] ?? MODES.balanced;
  const topK = prefs.topK ?? 10;
  const maxNodes = limits.maxNodes ?? 4_000_000;
  const maxMs = limits.maxMs ?? 8000;
  const daysOff = new Set(prefs.daysOff ?? []);
  const t0 = Date.now();

  // 1. Hard filters per option.
  const blocked = [];
  const prepared = courses.map(c => {
    const reasons = { dayOff: 0, early: 0, late: 0 };
    const options = c.options.map(o => ({ ...o, slots: mergeSlots(o.slots) })).filter(o => {
      for (const [d, s, e] of o.slots) {
        if (daysOff.has(d)) return reasons.dayOff++, false;
        if (prefs.earliest != null && s < prefs.earliest) return reasons.early++, false;
        if (prefs.latest != null && e > prefs.latest) return reasons.late++, false;
      }
      return true;
    });
    if (!options.length) blocked.push({ id: c.id, name: c.name, total: c.options.length, reasons });
    // Static ordering: compact options first, open groups before full ones.
    const key = o => new Set(o.slots.map(s => s[0])).size * 1000 + (o.full ? 500 : 0) + o.slots.reduce((m, s) => m + s[2] - s[1], 0) / 60;
    options.sort((a, b) => key(a) - key(b));
    const maxBusy = Math.max(0, ...options.map(o => o.slots.reduce((m, s) => m + s[2] - s[1], 0)));
    return { ...c, options, maxBusy };
  });
  if (blocked.length) return { results: [], blocked, nodes: 0, exhaustive: true, ms: Date.now() - t0 };

  // 2. Branch and bound, most-constrained course first.
  const order = prepared.slice().sort((a, b) => a.options.length - b.options.length);
  const remBusy = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) remBusy[i] = remBusy[i + 1] + order[i].maxBusy;

  const occ = Array.from({ length: 6 }, () => []); // placed intervals per day
  const dStart = new Array(6).fill(Infinity), dEnd = new Array(6).fill(-Infinity);
  const chosen = new Array(order.length);
  let busy = 0, nodes = 0, aborted = false;
  const best = []; // sorted ascending by score

  const lowerBound = depth => {
    let days = 0, sumSpan = 0, maxSpan = 0;
    for (let d = 0; d < 6; d++) {
      if (dEnd[d] < 0) continue;
      days++;
      const span = dEnd[d] - dStart[d];
      sumSpan += span;
      if (span > maxSpan) maxSpan = span;
    }
    const minGaps = Math.max(0, sumSpan - busy - remBusy[depth]);
    return w.days * 60 * days + w.gaps * minGaps + w.span * sumSpan + w.max * maxSpan;
  };

  const record = () => {
    const slots = chosen.flatMap(o => o.slots);
    const stats = scheduleStats(slots);
    const fullCount = chosen.filter(o => o.full).length;
    const score = scoreOf(stats, w) + (prefs.avoidFull ? FULL_PENALTY * fullCount : 0);
    if (best.length >= topK && score >= best[best.length - 1].score) return;
    const picks = {};
    order.forEach((c, i) => (picks[c.id] = chosen[i].picks));
    best.push({ score: Math.round(score), stats: { ...stats, daily: undefined }, daily: stats.daily, picks, fullCount });
    best.sort((a, b) => a.score - b.score);
    if (best.length > topK) best.pop();
  };

  const dfs = depth => {
    if (aborted) return;
    if (++nodes > maxNodes || (nodes % 4096 === 0 && Date.now() - t0 > maxMs)) { aborted = true; return; }
    if (depth === order.length) return record();
    if (best.length >= topK && lowerBound(depth) >= best[best.length - 1].score) return;
    const free = order[depth].allowOverlap;
    for (const opt of order[depth].options) {
      let ok = true;
      for (const [d, s, e] of free ? [] : opt.slots) {
        for (const [ps, pe, f] of occ[d]) if (!f && s < pe && ps < e) { ok = false; break; }
        if (!ok) break;
      }
      if (!ok) continue;
      // place
      const saved = opt.slots.map(([d]) => [d, dStart[d], dEnd[d]]);
      for (const [d, s, e] of opt.slots) {
        occ[d].push([s, e, free]);
        if (s < dStart[d]) dStart[d] = s;
        if (e > dEnd[d]) dEnd[d] = e;
        busy += e - s;
      }
      chosen[depth] = opt;
      dfs(depth + 1);
      // undo
      for (let k = opt.slots.length - 1; k >= 0; k--) {
        const [d, s, e] = opt.slots[k];
        occ[d].pop();
        busy -= e - s;
        dStart[d] = saved[k][1];
        dEnd[d] = saved[k][2];
      }
      if (aborted) return;
    }
  };
  dfs(0);
  return { results: best, blocked: [], nodes, exhaustive: !aborted, ms: Date.now() - t0 };
}
