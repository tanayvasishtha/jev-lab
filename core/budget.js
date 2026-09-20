/**
 * Cost estimation and hard spend cap.
 * Pricing: $0.042 per million input tokens; output free.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const INPUT_USD_PER_MILLION = 0.042;

export function estimateTokensFromChars(charCount) {
  return Math.ceil(charCount / 4);
}

export function estimateCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * INPUT_USD_PER_MILLION;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = { limit: null, seed: 42, yes: false, cap: 5, noCache: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--no-cache") flags.noCache = true;
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice(8));
    else if (arg === "--limit" && argv[i + 1] && !argv[i + 1].startsWith("--"))
      flags.limit = Number(argv[++i]);
    else if (arg.startsWith("--seed=")) flags.seed = Number(arg.slice(7));
    else if (arg === "--seed" && argv[i + 1] && !argv[i + 1].startsWith("--"))
      flags.seed = Number(argv[++i]);
    else if (arg.startsWith("--cap=")) flags.cap = Number(arg.slice(6));
    else if (arg === "--cap" && argv[i + 1] && !argv[i + 1].startsWith("--"))
      flags.cap = Number(argv[++i]);
  }
  return flags;
}

export function printEstimate({
  name,
  items,
  calls,
  estInputTokens,
  estCostUsd,
  cacheHits = 0,
  cap,
}) {
  const tok =
    estInputTokens >= 1_000_000
      ? `${(estInputTokens / 1_000_000).toFixed(2)}M`
      : estInputTokens >= 1000
        ? `${(estInputTokens / 1000).toFixed(1)}k`
        : String(estInputTokens);
  console.log(`Run: ${name}`);
  console.log(`Items: ${items}   Calls: ${calls}   Est. input tokens: ${tok}`);
  console.log(
    `Est. cost: $${Number(estCostUsd).toFixed(4)}   Cache hits: ${cacheHits}   Budget cap: $${Number(cap).toFixed(2)}`,
  );
}

export async function confirmProceed(yes) {
  if (yes) {
    console.log("Proceeding (--yes).");
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new Error("Refusing to proceed without --yes when stdin is not a TTY.");
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Proceed? [Y/n] ");
    if (answer.trim() && !/^\s*y(es)?\s*$/i.test(answer)) {
      throw new Error("Aborted by user.");
    }
    return true;
  } finally {
    rl.close();
  }
}

export class BudgetTracker {
  constructor(capUsd) {
    this.capUsd = capUsd;
    this.spentUsd = 0;
    this.calls = 0;
    this.inputTokens = 0;
  }
  addLive({ inputTokens, estimated = false }) {
    this.calls += 1;
    this.inputTokens += inputTokens;
    this.spentUsd += estimateCostUsd(inputTokens);
    if (this.calls % 500 === 0) {
      console.log(
        `Spend so far: $${this.spentUsd.toFixed(4)} over ${this.calls} live calls` +
          (estimated ? " (token counts estimated)" : ""),
      );
    }
    if (this.spentUsd > this.capUsd) {
      throw new Error(
        `Budget cap exceeded: spent $${this.spentUsd.toFixed(4)} > cap $${this.capUsd.toFixed(2)}`,
      );
    }
  }
}
