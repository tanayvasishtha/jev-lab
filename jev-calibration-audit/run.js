/**
 * Calibration audit collection. Method locked in PREREGISTER.md.
 * Usage: node jev-calibration-audit/run.js --limit 50 --yes
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runExperiment,
  noul,
  parseArgs,
  MODEL_ID,
} from "../core/runner.js";
import { loadBoolQ, sample } from "../core/datasets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

const EXPERIMENT = "jev-calibration-audit";

/** Frozen in PREREGISTER.md — do not rephrase. */
function buildAnswerQuestion(question) {
  return noul(`Is the following statement true? ${question}`);
}

function buildRequest(item) {
  return {
    id: item.id,
    condition: "alone",
    state: item.passage,
    questions: {
      answer: buildAnswerQuestion(item.question),
    },
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const all = await loadBoolQ();
  const items = flags.limit != null ? sample(all, flags.limit, flags.seed) : all;

  console.log(
    `Calibration run: model=${MODEL_ID} seed=${flags.seed} n=${items.length}` +
      (flags.limit != null ? ` (--limit ${flags.limit})` : " (full sample)"),
  );

  const startedAt = new Date().toISOString();
  const { results, spentUsd, liveCalls } = await runExperiment({
    name: EXPERIMENT,
    items,
    buildRequest,
    flags,
  });
  const finishedAt = new Date().toISOString();

  console.log(
    `Done. newRecords=${results.length} liveCalls=${liveCalls} spentUsd=$${spentUsd.toFixed(4)}`,
  );
  console.log(`startedAt=${startedAt} finishedAt=${finishedAt}`);
  console.log(`Next: node jev-calibration-audit/analyze.js`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
