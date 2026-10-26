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
 * { courses: [id], picks: {id: {typeCode: iid}}, excluded: {id: [typeCode]}, locked: {id: true}, overlap: {id: true} }
 */
export function plan() {
  const key = `${state.year}-${state.sem}`;
  const p = (state.plans[key] ??= { courses: [], picks: {}, excluded: {}, locked: {}, overlap: {} });
  p.overlap ??= {};
  return p;
}
