/**
 * Bundle-bias analysis. Reads data/raw/jev-bundle-bias.jsonl.
 * Usage: node jev-bundle-bias/analyze.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoolQ } from "../core/datasets.js";
import { rawPath } from "../core/store.js";
import { mcnemar, bootstrapCI } from "../core/stats.js";
import { estimateCostUsd } from "../core/budget.js";
import { MODEL_ID } from "../core/client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPERIMENT = "jev-bundle-bias";
const BOOT_SAMPLES = 10_000;

async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") throw new Error(`Missing raw file ${file}. Run run.js first.`);
    throw err;
  }
  const rows = [];
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function baseId(recordId) {
  return recordId.split("__")[0];
}

function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function positionBucket(pos) {
  if (pos <= 2) return "early";
  if (pos <= 6) return "mid";
  return "late";
}

async function main() {
  const records = await readJsonl(rawPath(EXPERIMENT));
  if (!records.length) throw new Error("No records to analyze");

  const boolq = await loadBoolQ();
  const byId = new Map(boolq.map((row) => [row.id, row]));

  const byTarget = new Map();
  let cacheHits = 0;
  let inputTokens = 0;
  let model = MODEL_ID;
  let startedAt = null;
  let finishedAt = null;

  for (const rec of records) {
    const tId = baseId(rec.id);
    if (!byTarget.has(tId)) byTarget.set(tId, { alone: null, bundled: [] });
    const entry = byTarget.get(tId);

    if (rec.condition === "alone") {
      entry.alone = rec;
    } else {
      const p = rec.answers?.[rec.targetKey]?.noul;
      if (typeof p !== "number") throw new Error(`Missing target noul for ${rec.id}`);
      entry.bundled.push({ ...rec, targetNoul: p });
    }

    if (rec.fromCache) cacheHits += 1;
    if (typeof rec.usage?.input_tokens === "number") inputTokens += rec.usage.input_tokens;
    if (rec.model) model = rec.model;
    if (rec.timestamp) {
      if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
      if (!finishedAt || rec.timestamp > finishedAt) finishedAt = rec.timestamp;
    }
  }

  const flips = [];
  const absShifts = [];
  const aloneCorrect = [];
  const bundledCorrect = [];
  const byBucket = { early: { flips: [], shifts: [] }, mid: { flips: [], shifts: [] }, late: { flips: [], shifts: [] } };
  const byComposition = { 1: { flips: [], shifts: [] }, 2: { flips: [], shifts: [] }, 3: { flips: [], shifts: [] } };
  let complete = 0;

  for (const [tId, entry] of byTarget) {
    const item = byId.get(tId);
    if (!item) throw new Error(`BoolQ id not found for target ${tId}`);
    if (!entry.alone || entry.bundled.length < 1) continue; // incomplete (e.g. --limit run)
    complete += 1;

    const pAlone = entry.alone.answer;
    const aloneWasCorrect = (pAlone >= 0.5) === item.label;

    for (const b of entry.bundled) {
      const pBundled = b.targetNoul;
      const flipped = (pAlone >= 0.5) !== (pBundled >= 0.5);
      const shift = Math.abs(pBundled - pAlone);
      flips.push(flipped ? 1 : 0);
      absShifts.push(shift);
      aloneCorrect.push(aloneWasCorrect);
      bundledCorrect.push((pBundled >= 0.5) === item.label);

      const bucket = byBucket[positionBucket(b.targetPosition)];
      bucket.flips.push(flipped ? 1 : 0);
      bucket.shifts.push(shift);

      const comp = byComposition[b.bundleIndex];
      if (comp) {
        comp.flips.push(flipped ? 1 : 0);
        comp.shifts.push(shift);
      }
    }
  }

  const flipRate = mean(flips);
  const meanShift = mean(absShifts);
  const flipRateCI = bootstrapCI(flips, mean, { samples: BOOT_SAMPLES, seed: 42 });
  const meanShiftCI = bootstrapCI(absShifts, mean, { samples: BOOT_SAMPLES, seed: 43 });
  const mcnemarResult = mcnemar(aloneCorrect, bundledCorrect);

  const positionBreakdown = Object.fromEntries(
    Object.entries(byBucket).map(([bucket, d]) => [
      bucket,
      { n: d.flips.length, flipRate: mean(d.flips), meanShift: mean(d.shifts) },
    ]),
  );
  const compositionBreakdown = Object.fromEntries(
    Object.entries(byComposition).map(([idx, d]) => [
      idx,
      { n: d.flips.length, flipRate: mean(d.flips), meanShift: mean(d.shifts) },
    ]),
  );

  const totalCalls = records.length;
  const liveCalls = totalCalls - cacheHits;
  const estimatedCost = estimateCostUsd(inputTokens);

  const results = {
    totalCalls,
    cacheHits,
    estimatedCost,
    model,
    seed: 42,
    startedAt,
    finishedAt,
    experiment: EXPERIMENT,
    targets: byTarget.size,
    completeTargets: complete,
    pairedComparisons: flips.length,
    flipRate,
    flipRateCI95: flipRateCI,
    meanAbsShift: meanShift,
    meanAbsShiftCI95: meanShiftCI,
    mcnemar: mcnemarResult,
    positionBreakdown,
    compositionBreakdown,
  };

  const outPath = path.join(HERE, "results.json");
  await fs.writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(
    `targets=${complete} flipRate=${flipRate.toFixed(4)} [${flipRateCI[0].toFixed(4)}, ${flipRateCI[1].toFixed(4)}] ` +
      `meanShift=${meanShift.toFixed(4)} mcnemar.p=${mcnemarResult.pValue.toFixed(4)} cost=$${estimatedCost.toFixed(6)}`,
  );

  const finite = [flipRate, meanShift, flipRateCI[0], flipRateCI[1], meanShiftCI[0], meanShiftCI[1]];
  if (!finite.every(Number.isFinite)) {
    throw new Error(`Non-finite headline metric: ${JSON.stringify(finite)}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
