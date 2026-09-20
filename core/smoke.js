/**
 * Harness self-test — 50 BoolQ items, four assertions (PLAN §2.8).
 * Usage: npm run smoke
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runExperiment,
  callJevCached,
  MODEL_ID,
  parseArgs,
  noul,
} from "./runner.js";
import { loadBoolQ, sample } from "./datasets.js";
import { ece, brier } from "./stats.js";
import { estimateCostUsd, printEstimate, confirmProceed } from "./budget.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function buildRequest(item) {
  return {
    id: item.id,
    condition: "smoke",
    state: item.passage,
    questions: {
      answer: noul(
        `Based only on the passage, is the answer to this question yes? ${item.question}`,
      ),
    },
  };
}

async function main() {
  const argv = ["--yes", "--limit=50", ...process.argv.slice(2)];
  const flags = parseArgs(argv);

  if (!process.env.TYPESAFE_API_KEY) {
    fail("TYPESAFE_API_KEY is not set. Copy .env.example to .env and add a key.");
  }

  console.log(`Smoke: model=${MODEL_ID}, seed=${flags.seed}, limit=50`);

  const all = await loadBoolQ();
  const items = sample(all, 50, flags.seed);
  if (items.length !== 50) fail(`Expected 50 sampled items, got ${items.length}`);

  const latencies = [];
  await runExperiment({
    name: "smoke",
    items,
    buildRequest,
    flags,
    onResult(record) {
      if (!record.fromCache) latencies.push(record.latencyMs);
    },
  });

  const collected = [];
  for (const item of items) {
    const req = buildRequest(item);
    const response = await callJevCached({
      state: req.state,
      questions: req.questions,
      noCache: false,
    });
    const noulVal = response.answers?.answer?.noul;
    if (typeof noulVal !== "number" || noulVal < 0 || noulVal > 1) {
      fail(`Documented shape failed for ${item.id}: ${JSON.stringify(response.answers)}`);
    }
    if (typeof response.model !== "string" || !response.model) {
      fail(`model field missing for ${item.id}`);
    }
    if (typeof response.latencyMs !== "number" || !Number.isFinite(response.latencyMs)) {
      fail(`latencyMs missing for ${item.id}`);
    }
    collected.push({ item, response, noulVal });
  }

  if (collected.length !== 50) fail(`Expected 50 successful calls, got ${collected.length}`);
  console.log("Assert 1 OK: 50 calls succeed with documented noul/model/latency shape");

  let cacheHits = 0;
  for (const { item } of collected) {
    const req = buildRequest(item);
    const response = await callJevCached({
      state: req.state,
      questions: req.questions,
      noCache: false,
    });
    if (!response.fromCache) fail(`Second run expected cache hit for ${item.id}`);
    cacheHits += 1;
  }

  const estCost = estimateCostUsd(0);
  printEstimate({
    name: "smoke-cache-check",
    items: 50,
    calls: 50,
    estInputTokens: 0,
    estCostUsd: estCost,
    cacheHits,
    cap: flags.cap,
  });
  await confirmProceed(true);

  if (cacheHits !== 50 || estCost !== 0) {
    fail(`Second run not fully cached: hits=${cacheHits}, estCost=$${estCost}`);
  }
  console.log("Assert 2 OK: second run fully from cache, est. new spend $0.00");

  for (const c of collected) {
    if (!Number.isFinite(c.response.latencyMs) || c.response.latencyMs < 0) {
      fail(`Insane latency for ${c.item.id}: ${c.response.latencyMs}`);
    }
    if (c.response.latencyMs >= 60_000) {
      fail(`Latency too high for ${c.item.id}: ${c.response.latencyMs}`);
    }
  }
  console.log(
    `Assert 3 OK: latency recorded (live samples=${latencies.length}, e.g. ${latencies[0] ?? collected[0].response.latencyMs}ms)`,
  );

  const p = collected.map((c) => c.noulVal);
  const y = collected.map((c) => c.item.label);
  const e = ece(p, y, 20);
  const b = brier(p, y);
  if (!Number.isFinite(e) || !Number.isFinite(b)) {
    fail(`ece/brier not finite: ece=${e}, brier=${b}`);
  }
  console.log(`Assert 4 OK: ece=${e.toFixed(4)}, brier=${b.toFixed(4)}`);
  console.log("SMOKE PASS");
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err?.message ?? err);
  process.exitCode = 1;
});
