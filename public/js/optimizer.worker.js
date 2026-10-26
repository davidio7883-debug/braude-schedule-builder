import { solve } from './optimizer.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ ok: true, ...solve(data.courses, data.prefs, data.limits) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
