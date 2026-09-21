/**
 * Pure race logic shared by the page (race.js) and the tests.
 * No DOM, no network, so it runs the same in the browser and in Node.
 */

/** Median of a list of numbers, rounded; null for an empty list. */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * The racer that answered first, by each model's own measured time.
 * results: [[id, { latencyMs } | { error }], ...]. Null unless at least two
 * racers answered, since "first" means nothing with one finisher.
 */
export function pickWinner(results) {
  const ok = results.filter(([, r]) => r && !r.error && Number.isFinite(r.latencyMs));
  if (ok.length < 2) return null;
  return ok.reduce((a, b) => (b[1].latencyMs < a[1].latencyMs ? b : a))[0];
}

/** A noul answer is "true" at 0.5 and above; right if that matches the truth. */
export function isCorrect(noul, truth) {
  return (noul >= 0.5) === truth;
}

/**
 * The shared race-track scale only grows, so earlier bars stay comparable.
 * Returns the new scale: unchanged unless ms is within 8% of the edge, in
 * which case it grows to 1.25x ms rounded up to the next 250 ms.
 */
export function nextScale(scaleMs, ms) {
  if (!(ms > scaleMs * 0.92)) return scaleMs;
  return Math.ceil((ms * 1.25) / 250) * 250;
}

/** Validates a typed question as both Jev and the local models accept it. */
export function validQuestion(q) {
  if (!q || typeof q.instructions !== "string" || !q.instructions.trim()) return false;
  if (q.instructions.length > 1000) return false;
  if (q.type === "noul") return true;
  if (q.type === "choice") return !!q.criteria && typeof q.criteria === "object" && !Array.isArray(q.criteria) && Object.keys(q.criteria).length >= 2;
  if (q.type === "score") return Array.isArray(q.criteria) && q.criteria.length >= 2;
  return false;
}
