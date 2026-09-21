/**
 * Ensemble-gain collection. Method locked in PREREGISTER.md.
 * Usage: node jev-ensemble-gain/run.js --limit 50 --yes
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExperiment, noul, choice, parseArgs } from "../core/runner.js";
import { loadBoolQ, sample } from "../core/datasets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

const EXPERIMENT = "jev-ensemble-gain";
const N_ITEMS = 500;
const REPEATS = 5;

/** Frozen in PREREGISTER.md, do not edit or reorder after data collection starts. */
const TEMPLATES = [
  (q) => `Is the following statement true? ${q}`,
  (q) => `True or false: ${q}`,
  (q) => `Based on the passage, is this correct? ${q}`,
  (q) => `Does the passage support this claim? ${q}`,
  (q) => `Evaluate: ${q}. Is it true?`,
  (q) => `${q}, true or false, based on the text above?`,
  (q) => `Fact-check this against the passage: ${q}`,
  (q) => `Is it accurate to say that ${q}`,
  (q) => `According to the passage, ${q}, true?`,
  (q) => `Verify: ${q}`,
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildVariantsForItem(item, itemIndex) {
  const rand = mulberry32(42 + itemIndex);
  const requests = [];
  let variantIndex = 0;

  for (let t = 0; t < TEMPLATES.length; t++) {
    const instruction = TEMPLATES[t](item.question);

    for (let r = 0; r < REPEATS; r++) {
      requests.push({
        id: `${item.id}__v${variantIndex}`,
        state: item.passage,
        templateIndex: t,
        questionType: "noul",
        questions: { answer: noul(instruction) },
      });
      variantIndex++;
    }

    for (let r = 0; r < REPEATS; r++) {
      const trueFirst = rand() < 0.5;
      const criteria = trueFirst
        ? { true: "The statement is true.", false: "The statement is false." }
        : { false: "The statement is false.", true: "The statement is true." };
      requests.push({
        id: `${item.id}__v${variantIndex}`,
        state: item.passage,
        templateIndex: t,
        questionType: "choice",
        optionOrder: trueFirst ? "true_first" : "false_first",
        questions: { answer: choice(instruction, criteria) },
      });
      variantIndex++;
    }
  }

  return requests;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const all = await loadBoolQ();
  const items = flags.limit != null
    ? sample(all, Math.min(flags.limit, N_ITEMS), 42)
    : sample(all, N_ITEMS, 42);

  const requests = [];
  items.forEach((item, i) => {
    for (const req of buildVariantsForItem(item, i)) requests.push({ id: req.id, req });
  });

  console.log(
    `Ensemble-gain run: items=${items.length} calls=${requests.length}` +
      (flags.limit != null ? ` (--limit ${flags.limit})` : " (full sample)"),
  );

  const startedAt = new Date().toISOString();
  const { results, spentUsd, liveCalls } = await runExperiment({
    name: EXPERIMENT,
    items: requests,
    buildRequest: (item) => item.req,
    flags,
  });
  const finishedAt = new Date().toISOString();

  console.log(`Done. newRecords=${results.length} liveCalls=${liveCalls} spentUsd=$${spentUsd.toFixed(4)}`);
  console.log(`startedAt=${startedAt} finishedAt=${finishedAt}`);
  console.log(`Next: node jev-ensemble-gain/analyze.js`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
