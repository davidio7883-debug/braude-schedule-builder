// Persistent UI state (localStorage) with a plan per year+semester.
const KEY = 'braude-schedule:v1';

const defaults = () => ({
  year: null,
  sem: null,
  degree: null,
  studyYear: 0,
  showAll: false,
  query: '',
  tab: 'courses',
  view: 'board',
  theme: 'auto',
  plans: {},
  // Only groups scheduled for the student's own degree are offered unless these say otherwise.
  showOtherDegrees: false,
  showFriday: false,
  courseColors: {}, // courseId -> '#rrggbb' chosen by the student
  otherDegreeCourses: {},
  prefs: { mode: 'balanced', daysOff: [], earliest: null, latest: null, avoidFull: true, respectLocks: true },
});

function load() {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults();
  }
}

export const state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

/**
 * Plan for the current term:
 * { courses: [id], picks: {id: {typeCode: iid}}, excluded: {id: [typeCode]}, locked: {id: true}, overlap: {id: true},
 *   hidden: {id: [iid]} }
 */
export function plan() {
  const key = `${state.year}-${state.sem}`;
  const p = (state.plans[key] ??= { courses: [], picks: {}, excluded: {}, locked: {}, overlap: {}, hidden: {} });
  p.overlap ??= {};
  p.hidden ??= {}; // courseId -> iids the student marked as not available to them
  return p;
}
