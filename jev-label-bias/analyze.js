/**
 * Label-bias analysis. Reads data/raw/jev-label-bias.jsonl.
 * Usage: node jev-label-bias/analyze.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rawPath } from "../core/store.js";
import { mcnemar } from "../core/stats.js";
import { estimateCostUsd } from "../core/budget.js";
import { MODEL_ID } from "../core/client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPERIMENT = "jev-label-bias";
const SCHEME_ORDER = ["neutral", "descriptive", "loaded", "adversarial"];

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

function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function baseId(recordId) {
  return recordId.split("__")[0];
}

async function main() {
  const records = await readJsonl(rawPath(EXPERIMENT));
  if (!records.length) throw new Error("No records to analyze");

  const byTicket = new Map();
  let cacheHits = 0;
  let inputTokens = 0;
  let model = MODEL_ID;
  let startedAt = null;
  let finishedAt = null;

  for (const rec of records) {
    const tId = baseId(rec.id);
    if (!byTicket.has(tId)) byTicket.set(tId, {});
    byTicket.get(tId)[rec.scheme] = {
      chosen: rec.answers.route.choice,
      // Compare by the underlying category, not the raw key string — every
      // scheme uses a different key vocabulary by design (option_b vs
      // billing vs unlikely), so raw key equality across schemes is
      // meaningless and would make "did the choice shift" trivially always
      // true.
      chosenCategory: rec.keyToCategory[rec.answers.route.choice],
      correct: rec.answers.route.choice === rec.correctKeyInThisScheme,
      confidence: rec.answers.route.confidence ?? null,
    };

    if (rec.fromCache) cacheHits += 1;
    if (typeof rec.usage?.input_tokens === "number") inputTokens += rec.usage.input_tokens;
    if (rec.model) model = rec.model;
    if (rec.timestamp) {
      if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
      if (!finishedAt || rec.timestamp > finishedAt) finishedAt = rec.timestamp;
    }
  }

  const complete = [...byTicket.entries()].filter(([, d]) => SCHEME_ORDER.every((s) => d[s]));

  const accuracyByScheme = {};
  const shiftVsNeutralByScheme = {};
  for (const scheme of SCHEME_ORDER) {
    accuracyByScheme[scheme] = mean(complete.map(([, d]) => (d[scheme].correct ? 1 : 0)));
  }
  for (const scheme of SCHEME_ORDER) {
    if (scheme === "neutral") continue;
    shiftVsNeutralByScheme[scheme] = mean(
      complete.map(([, d]) => (d[scheme].chosenCategory === d.neutral.chosenCategory ? 0 : 1)),
    );
  }

  const mcnemarVsNeutral = {};
  for (const scheme of SCHEME_ORDER) {
    if (scheme === "neutral") continue;
    mcnemarVsNeutral[scheme] = mcnemar(
      complete.map(([, d]) => d.neutral.correct),
      complete.map(([, d]) => d[scheme].correct),
    );
  }

  // Worked example: the ticket with the biggest neutral -> adversarial swing
  // (neutral correct, adversarial incorrect), picked deterministically as the
  // first such ticket in id order for reproducibility.
  const flippedByAdversarial = complete
    .filter(([, d]) => d.neutral.correct && !d.adversarial.correct)
    .sort(([a], [b]) => a.localeCompare(b));
  const example = flippedByAdversarial[0] ?? complete[0];
  const exampleRecord = records.find((r) => baseId(r.id) === example[0] && r.scheme === "neutral");
  const exampleAdversarial = records.find((r) => baseId(r.id) === example[0] && r.scheme === "adversarial");

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
    tickets: byTicket.size,
    completeTickets: complete.length,
    accuracyByScheme,
    shiftVsNeutralByScheme,
    mcnemarVsNeutral,
    workedExample: exampleRecord
      ? {
          ticketId: example[0],
          state: exampleRecord.state,
          neutralCriteria: exampleRecord.questions.route.criteria,
          neutralChoice: example[1].neutral.chosen,
          neutralCorrect: example[1].neutral.correct,
          adversarialCriteria: exampleAdversarial.questions.route.criteria,
          adversarialChoice: example[1].adversarial.chosen,
          adversarialCorrect: example[1].adversarial.correct,
        }
      : null,
  };

  const outPath = path.join(HERE, "results.json");
  await fs.writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(
    `tickets=${complete.length} acc.neutral=${accuracyByScheme.neutral.toFixed(4)} ` +
      `acc.adversarial=${accuracyByScheme.adversarial.toFixed(4)} ` +
      `mcnemar.adversarial.p=${mcnemarVsNeutral.adversarial.pValue.toFixed(4)} cost=$${estimatedCost.toFixed(6)}`,
  );

  const finite = Object.values(accuracyByScheme);
  if (!finite.every(Number.isFinite)) {
    throw new Error(`Non-finite accuracy: ${JSON.stringify(accuracyByScheme)}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
