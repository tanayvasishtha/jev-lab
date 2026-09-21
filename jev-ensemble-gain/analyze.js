/**
 * Ensemble-gain analysis. Reads data/raw/jev-ensemble-gain.jsonl.
 * Usage: node jev-ensemble-gain/analyze.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { loadBoolQ } from "../core/datasets.js";
import { rawPath } from "../core/store.js";
import { ece } from "../core/stats.js";
import { estimateCostUsd } from "../core/budget.js";
import { MODEL_ID } from "../core/client.js";

const gunzipAsync = promisify(gunzip);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPERIMENT = "jev-ensemble-gain";
const SIZES = [1, 2, 5, 10, 25, 50, 100];
const TRIALS_PER_SIZE = 200;
const TRIAL_SEED = 42;

async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // This experiment's raw file is committed gzipped (56MB uncompressed,
      // over GitHub's size warning; ~1.5MB gzipped) since, unlike
      // bundle-bias, no page fetches it live in the browser; it's a
      // download link only. A fresh clone won't have the plain .jsonl, so
      // fall back to the .gz instead of failing.
      try {
        const gz = await fs.readFile(`${file}.gz`);
        text = (await gunzipAsync(gz)).toString("utf8");
      } catch (gzErr) {
        if (gzErr && gzErr.code === "ENOENT") {
          throw new Error(`Missing raw file ${file} (and ${file}.gz). Run run.js first.`);
        }
        throw gzErr;
      }
    } else {
      throw err;
    }
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

function extractProb(rec) {
  if (rec.questionType === "noul") return rec.answers.answer.noul;
  return rec.answers.answer.probabilities.true;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw `size` distinct indices from [0, n) using the given RNG. */
function sampleIndices(rand, n, size) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0 && idx.length - i <= size; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(idx.length - size);
}

async function main() {
  const records = await readJsonl(rawPath(EXPERIMENT));
  if (!records.length) throw new Error("No records to analyze");

  const boolq = await loadBoolQ();
  const byId = new Map(boolq.map((row) => [row.id, row]));

  const byItem = new Map();
  let cacheHits = 0;
  let inputTokens = 0;
  let liveCallCount = 0;
  let model = MODEL_ID;
  let startedAt = null;
  let finishedAt = null;

  for (const rec of records) {
    const iId = baseId(rec.id);
    if (!byItem.has(iId)) byItem.set(iId, []);
    byItem.get(iId).push(extractProb(rec));

    if (rec.fromCache) cacheHits += 1;
    else {
      liveCallCount += 1;
      if (typeof rec.usage?.input_tokens === "number") inputTokens += rec.usage.input_tokens;
    }
    if (rec.model) model = rec.model;
    if (rec.timestamp) {
      if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
      if (!finishedAt || rec.timestamp > finishedAt) finishedAt = rec.timestamp;
    }
  }

  const items = [...byItem.entries()]
    .map(([id, probs]) => ({ id, probs, label: byId.get(id)?.label }))
    .filter((it) => it.label !== undefined && it.probs.length > 0);

  const perSize = {};
  for (const size of SIZES) {
    const rand = mulberry32(TRIAL_SEED + size);
    const trialAccMean = [];
    const trialAccVote = [];
    const trialEce = [];

    for (let trial = 0; trial < TRIALS_PER_SIZE; trial++) {
      const meanPreds = [];
      const votePreds = [];
      const labels = [];
      const meanProbs = [];
      for (const item of items) {
        const n = item.probs.length;
        const drawSize = Math.min(size, n);
        const idxs = sampleIndices(rand, n, drawSize);
        const drawn = idxs.map((i) => item.probs[i]);
        const pMean = mean(drawn);
        const vote = mean(drawn.map((p) => (p >= 0.5 ? 1 : 0)));
        meanPreds.push(pMean >= 0.5 ? 1 : 0);
        votePreds.push(vote >= 0.5 ? 1 : 0);
        meanProbs.push(pMean);
        labels.push(item.label ? 1 : 0);
      }
      trialAccMean.push(mean(meanPreds.map((p, i) => (p === labels[i] ? 1 : 0))));
      trialAccVote.push(mean(votePreds.map((p, i) => (p === labels[i] ? 1 : 0))));
      trialEce.push(ece(meanProbs, labels, 10));
    }

    perSize[size] = {
      accuracyMean: mean(trialAccMean),
      accuracyVote: mean(trialAccVote),
      ece: mean(trialEce),
    };
  }

  const acc100 = perSize[100].accuracyMean;
  let saturationSize = 100;
  for (const size of SIZES) {
    if (Math.abs(perSize[size].accuracyMean - acc100) <= 0.01) {
      saturationSize = size;
      break;
    }
  }

  const avgInputTokensPerCall = liveCallCount ? inputTokens / liveCallCount : 0;
  const costPerSize = {};
  for (const size of SIZES) {
    costPerSize[size] = estimateCostUsd(avgInputTokensPerCall * size * items.length);
  }

  const totalCalls = records.length;
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
    items: items.length,
    variantsPerItem: 100,
    trialsPerSize: TRIALS_PER_SIZE,
    sizes: SIZES,
    perSize,
    saturationSize,
    saturationAccuracy: perSize[saturationSize].accuracyMean,
    costPerSize,
  };

  const outPath = path.join(HERE, "results.json");
  await fs.writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(
    `items=${items.length} acc@1=${perSize[1].accuracyMean.toFixed(4)} acc@100=${acc100.toFixed(4)} ` +
      `saturation=${saturationSize} cost@sat=$${costPerSize[saturationSize].toFixed(4)} totalCost=$${estimatedCost.toFixed(4)}`,
  );

  const finite = SIZES.map((s) => perSize[s].accuracyMean).concat(SIZES.map((s) => perSize[s].ece));
  if (!finite.every(Number.isFinite)) {
    throw new Error(`Non-finite metric in perSize: ${JSON.stringify(perSize)}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
