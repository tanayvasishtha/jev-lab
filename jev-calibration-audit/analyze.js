/**
 * Calibration audit analysis. Reads data/raw/jev-calibration-audit.jsonl.
 * Usage: node jev-calibration-audit/analyze.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoolQ } from "../core/datasets.js";
import { rawPath } from "../core/store.js";
import { ece, brier, entropy, accuracy } from "../core/stats.js";
import { estimateCostUsd } from "../core/budget.js";
import { MODEL_ID } from "../core/client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPERIMENT = "jev-calibration-audit";
const BINS = 20;
const BOOT_SAMPLES = 10_000;
const BOOT_SEED = 42;

async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`Missing raw file ${file}. Run run.js first.`);
    }
    throw err;
  }
  const rows = [];
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function reliabilityDiagram(probs, labels, bins = BINS) {
  const out = Array.from({ length: bins }, (_, i) => ({
    bin: i,
    lo: i / bins,
    hi: (i + 1) / bins,
    count: 0,
    sumProb: 0,
    sumLabel: 0,
    meanProb: null,
    accuracy: null,
  }));
  for (let i = 0; i < probs.length; i++) {
    const p = Math.min(1, Math.max(0, probs[i]));
    let b = Math.floor(p * bins);
    if (b >= bins) b = bins - 1;
    out[b].count += 1;
    out[b].sumProb += p;
    out[b].sumLabel += labels[i] ? 1 : 0;
  }
  return out.map((row) => {
    const meanProb = row.count ? row.sumProb / row.count : null;
    const acc = row.count ? row.sumLabel / row.count : null;
    return {
      bin: row.bin,
      lo: row.lo,
      hi: row.hi,
      count: row.count,
      meanProb,
      accuracy: acc,
    };
  });
}

function binaryEntropy(p) {
  const x = Math.min(1, Math.max(0, p));
  return entropy([x, 1 - x]);
}

function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function bootstrapPaired(probs, labels, statistic, { samples, seed }) {
  const n = probs.length;
  if (!n) return [NaN, NaN];
  let t = seed >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const scores = new Array(samples);
  const pDraw = new Array(n);
  const yDraw = new Array(n);
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      pDraw[i] = probs[j];
      yDraw[i] = labels[j];
    }
    scores[s] = statistic(pDraw, yDraw);
  }
  scores.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * samples);
  const hiIdx = Math.min(samples - 1, Math.floor(0.975 * samples));
  return [scores[loIdx], scores[hiIdx]];
}

async function main() {
  const records = await readJsonl(rawPath(EXPERIMENT));
  if (!records.length) throw new Error("No records to analyze");

  const boolq = await loadBoolQ();
  const byId = new Map(boolq.map((row) => [row.id, row]));

  const probs = [];
  const labels = [];
  const liveLatency = [];
  let cacheHits = 0;
  let inputTokens = 0;
  let model = MODEL_ID;
  let startedAt = null;
  let finishedAt = null;

  for (const rec of records) {
    const item = byId.get(rec.id);
    if (!item) throw new Error(`BoolQ id not found for record ${rec.id}`);

    const p =
      typeof rec.answer === "number" ? rec.answer : rec.answers?.answer?.noul;
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
      throw new Error(`Bad noul for ${rec.id}: ${JSON.stringify(rec.answers)}`);
    }

    probs.push(p);
    labels.push(!!item.label);

    if (rec.fromCache) cacheHits += 1;
    else {
      liveLatency.push({
        latencyMs: rec.latencyMs,
        entropy: binaryEntropy(p),
      });
    }

    if (typeof rec.usage?.input_tokens === "number") {
      inputTokens += rec.usage.input_tokens;
    }
    if (rec.model) model = rec.model;
    if (rec.timestamp) {
      if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
      if (!finishedAt || rec.timestamp > finishedAt) finishedAt = rec.timestamp;
    }
  }

  const totalCalls = records.length;
  const liveCalls = totalCalls - cacheHits;
  const eceVal = ece(probs, labels, BINS);
  const brierVal = brier(probs, labels);
  const accVal = accuracy(probs, labels);
  const reliability = reliabilityDiagram(probs, labels, BINS);

  const [eceLo, eceHi] = bootstrapPaired(
    probs,
    labels,
    (p, y) => ece(p, y, BINS),
    { samples: BOOT_SAMPLES, seed: BOOT_SEED },
  );
  const [brierLo, brierHi] = bootstrapPaired(probs, labels, (p, y) => brier(p, y), {
    samples: BOOT_SAMPLES,
    seed: BOOT_SEED + 1,
  });
  const [accLo, accHi] = bootstrapPaired(probs, labels, (p, y) => accuracy(p, y), {
    samples: BOOT_SAMPLES,
    seed: BOOT_SEED + 2,
  });

  const estimatedCost = estimateCostUsd(inputTokens);

  const results = {
    // PLAN §3.7 required fields
    totalCalls,
    cacheHits,
    estimatedCost,
    model,
    seed: 42,
    startedAt,
    finishedAt,
    // Experiment metrics
    experiment: EXPERIMENT,
    n: totalCalls,
    liveCalls,
    bins: BINS,
    ece: eceVal,
    eceCI95: [eceLo, eceHi],
    brier: brierVal,
    brierCI95: [brierLo, brierHi],
    accuracy: accVal,
    accuracyCI95: [accLo, accHi],
    reliability,
    latencyVsEntropy: {
      n: liveLatency.length,
      meanLatencyMs: mean(liveLatency.map((d) => d.latencyMs)),
      meanEntropy: mean(liveLatency.map((d) => d.entropy)),
      points: liveLatency,
    },
  };

  const outPath = path.join(HERE, "results.json");
  await fs.writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(
    `n=${results.n} ece=${eceVal.toFixed(4)} [${eceLo.toFixed(4)}, ${eceHi.toFixed(4)}] ` +
      `brier=${brierVal.toFixed(4)} acc=${accVal.toFixed(4)} cost=$${estimatedCost.toFixed(6)} ` +
      `cacheHits=${cacheHits} liveCalls=${liveCalls}`,
  );

  const finite = [eceVal, brierVal, accVal, eceLo, eceHi, brierLo, brierHi, accLo, accHi];
  if (!finite.every(Number.isFinite)) {
    throw new Error(`Non-finite headline metric: ${JSON.stringify(finite)}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
