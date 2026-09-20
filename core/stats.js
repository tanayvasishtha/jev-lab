/** Calibration and paired-comparison stats. */

export function ece(probs, labels, bins = 10) {
  if (probs.length !== labels.length) throw new Error("ece: length mismatch");
  if (probs.length === 0) return NaN;
  const sums = Array.from({ length: bins }, () => ({ conf: 0, acc: 0, n: 0 }));
  for (let i = 0; i < probs.length; i++) {
    const p = Math.min(1, Math.max(0, probs[i]));
    const y = labels[i] ? 1 : 0;
    let b = Math.floor(p * bins);
    if (b >= bins) b = bins - 1;
    sums[b].conf += p;
    sums[b].acc += y;
    sums[b].n += 1;
  }
  let err = 0;
  const n = probs.length;
  for (const bucket of sums) {
    if (!bucket.n) continue;
    err += (bucket.n / n) * Math.abs(bucket.acc / bucket.n - bucket.conf / bucket.n);
  }
  return err;
}

export function brier(probs, labels) {
  if (probs.length !== labels.length) throw new Error("brier: length mismatch");
  if (probs.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < probs.length; i++) {
    const d = probs[i] - (labels[i] ? 1 : 0);
    s += d * d;
  }
  return s / probs.length;
}

export function bootstrapCI(values, statistic, { samples = 1000, alpha = 0.05, seed = 0 } = {}) {
  if (values.length === 0) return [NaN, NaN];
  let t = seed >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const scores = new Array(samples);
  const n = values.length;
  const draw = new Array(n);
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < n; i++) draw[i] = values[Math.floor(rand() * n)];
    scores[s] = statistic(draw);
  }
  scores.sort((a, b) => a - b);
  const loIdx = Math.floor((alpha / 2) * samples);
  const hiIdx = Math.min(samples - 1, Math.floor((1 - alpha / 2) * samples));
  return [scores[loIdx], scores[hiIdx]];
}

function logBinom(n, k) {
  if (k < 0 || k > n) return -Infinity;
  k = Math.min(k, n - k);
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

function binomPmf(n, k) {
  return Math.exp(logBinom(n, k) - n * Math.LN2);
}

/** McNemar mid-p test on paired boolean correctness. */
export function mcnemar(aCorrect, bCorrect) {
  if (aCorrect.length !== bCorrect.length) throw new Error("mcnemar: length mismatch");
  let b = 0;
  let c = 0;
  for (let i = 0; i < aCorrect.length; i++) {
    const a = !!aCorrect[i];
    const bc = !!bCorrect[i];
    if (!a && bc) b += 1;
    else if (a && !bc) c += 1;
  }
  const n = b + c;
  if (n === 0) return { b, c, pValue: 1 };
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binomPmf(n, i);
  let p = 2 * (tail - 0.5 * binomPmf(n, k));
  if (p > 1) p = 1;
  if (p < 0) p = 0;
  return { b, c, pValue: p };
}

export function entropy(probs) {
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log(p);
  return h;
}

export function accuracy(preds, labels) {
  if (preds.length !== labels.length || preds.length === 0) return NaN;
  let ok = 0;
  for (let i = 0; i < preds.length; i++) {
    if ((preds[i] >= 0.5) === !!labels[i]) ok += 1;
  }
  return ok / preds.length;
}
