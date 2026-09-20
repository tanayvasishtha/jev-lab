/**
 * Bundle-bias collection. Method locked in PREREGISTER.md.
 * Usage: node jev-bundle-bias/run.js --limit 50 --yes
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExperiment, noul, parseArgs } from "../core/runner.js";
import { loadBoolQ, sample } from "../core/datasets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

const EXPERIMENT = "jev-bundle-bias";
const N_FILLERS = 9;
const N_COMPOSITIONS = 3;

/** Frozen in PREREGISTER.md — do not rephrase. Identical to calibration-audit's
 * phrasing on purpose, so an overlapping item is a free cache hit. */
function questionFor(item) {
  return noul(`Is the following statement true? ${item.question}`);
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

function pickFillers(pool, targetIdx, compositionSeed, n) {
  const rand = mulberry32(compositionSeed);
  const idx = [];
  const seen = new Set([targetIdx]);
  while (idx.length < n) {
    const j = Math.floor(rand() * pool.length);
    if (seen.has(j)) continue;
    seen.add(j);
    idx.push(j);
  }
  return { fillers: idx.map((j) => pool[j]), rand };
}

function buildRequestsForTarget(target, targetIdx, pool) {
  const requests = [];

  // Condition 1: alone.
  requests.push({
    id: `${target.id}__alone`,
    condition: "alone",
    state: target.passage,
    questions: { answer: questionFor(target) },
  });

  // Conditions 2-4: bundled, 3 independent compositions.
  for (let b = 1; b <= N_COMPOSITIONS; b++) {
    const compositionSeed = 42 + targetIdx * 1000 + b;
    const { fillers, rand } = pickFillers(pool, targetIdx, compositionSeed, N_FILLERS);
    const targetPosition = Math.floor(rand() * (N_FILLERS + 1)); // 0..9

    const slots = new Array(N_FILLERS + 1);
    let fillerCursor = 0;
    for (let pos = 0; pos <= N_FILLERS; pos++) {
      slots[pos] = pos === targetPosition ? { item: target, isTarget: true } : { item: fillers[fillerCursor++], isTarget: false };
    }

    const questions = {};
    const stateLines = [];
    slots.forEach((slot, pos) => {
      const key = `q${pos}`;
      questions[key] = questionFor(slot.item);
      stateLines.push(`[${key}] ${slot.item.passage}`);
    });

    requests.push({
      id: `${target.id}__bundle${b}`,
      condition: "bundled",
      bundleIndex: b,
      targetPosition,
      targetKey: `q${targetPosition}`,
      state: stateLines.join("\n"),
      questions,
    });
  }

  return requests;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const all = await loadBoolQ();
  const targets = sample(all, flags.limit != null ? Math.min(flags.limit, 2000) : 2000, 42);

  const items = [];
  targets.forEach((target, targetIdx) => {
    for (const req of buildRequestsForTarget(target, targetIdx, all)) {
      items.push({ id: req.id, req });
    }
  });

  console.log(
    `Bundle-bias run: targets=${targets.length} calls=${items.length}` +
      (flags.limit != null ? ` (--limit ${flags.limit})` : " (full sample)"),
  );

  const startedAt = new Date().toISOString();
  const { results, spentUsd, liveCalls } = await runExperiment({
    name: EXPERIMENT,
    items,
    buildRequest: (item) => item.req,
    flags,
  });
  const finishedAt = new Date().toISOString();

  console.log(
    `Done. newRecords=${results.length} liveCalls=${liveCalls} spentUsd=$${spentUsd.toFixed(4)}`,
  );
  console.log(`startedAt=${startedAt} finishedAt=${finishedAt}`);
  console.log(`Next: node jev-bundle-bias/analyze.js`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
