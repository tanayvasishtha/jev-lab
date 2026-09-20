/**
 * Experiment-facing harness. Only client.js imports the SDK.
 */
import { callJev, MODEL_ID, noul, choice, score } from "./client.js";
import { schedule, notify429 } from "./limiter.js";
import { cacheKey, cacheGet, cacheSet } from "./cache.js";
import {
  parseArgs,
  printEstimate,
  confirmProceed,
  estimateTokensFromChars,
  estimateCostUsd,
  BudgetTracker,
} from "./budget.js";
import { appendRecord, readExistingIds } from "./store.js";

// RateLimitError is not exported from client — detect via message/status.
import { RateLimitError as SDKRateLimitError } from "@typesafe-ai/sdk";

export { MODEL_ID, noul, choice, score, parseArgs };

export async function callJevCached({
  state,
  questions,
  model = MODEL_ID,
  noCache = false,
}) {
  const key = cacheKey({ state, questions, model });
  if (!noCache) {
    const hit = await cacheGet(key);
    if (hit) {
      return { ...hit, requestHash: key, fromCache: true };
    }
  }

  try {
    const result = await schedule(() => callJev({ state, questions, model }));
    const record = {
      model: result.model,
      answers: result.answers,
      usage: result.usage,
      latencyMs: result.latencyMs,
      requestHash: result.requestHash,
      timestamp: new Date().toISOString(),
    };
    await cacheSet(key, record);
    return { ...record, fromCache: false };
  } catch (err) {
    if (
      err instanceof SDKRateLimitError ||
      err?.cause instanceof SDKRateLimitError ||
      /429/.test(String(err?.message))
    ) {
      notify429();
    }
    throw err;
  }
}

function qChars(questions) {
  return JSON.stringify(questions).length;
}

/**
 * buildRequest(item) -> { id, state, questions, condition? }
 */
export async function runExperiment({
  name,
  items,
  buildRequest,
  flags,
  onResult,
}) {
  const existing = await readExistingIds(name);
  const pending = [];
  for (const item of items) {
    const req = buildRequest(item);
    const id = String(req.id ?? item.id);
    if (existing.has(id)) continue;
    pending.push({ item, req: { ...req, id } });
  }

  let estTokens = 0;
  for (const { req } of pending) {
    const chars =
      (typeof req.state === "string"
        ? req.state.length
        : JSON.stringify(req.state).length) + qChars(req.questions);
    estTokens += estimateTokensFromChars(chars);
  }

  printEstimate({
    name,
    items: items.length,
    calls: pending.length,
    estInputTokens: estTokens,
    estCostUsd: estimateCostUsd(estTokens),
    cacheHits: items.length - pending.length,
    cap: flags.cap,
  });
  await confirmProceed(flags.yes);

  const tracker = new BudgetTracker(flags.cap);
  const results = [];
  // "Consecutive" under concurrency means "in the last N completions", not
  // literally sequential — still a real circuit breaker against a failure
  // storm (e.g. a bad API key or a dead endpoint), just not exact ordering.
  let consecutiveFailures = 0;
  let aborted = null;

  async function processOne({ item, req }) {
    if (aborted) return;
    try {
      const response = await callJevCached({
        state: req.state,
        questions: req.questions,
        noCache: flags.noCache,
      });

      if (!response.fromCache) {
        const inputTokens =
          response.usage?.input_tokens ??
          estimateTokensFromChars(
            (typeof req.state === "string"
              ? req.state.length
              : JSON.stringify(req.state).length) + qChars(req.questions),
          );
        tracker.addLive({
          inputTokens,
          estimated: response.usage?.input_tokens == null,
        });
      }

      const answerEntry =
        response.answers?.answer ?? Object.values(response.answers ?? {})[0];
      const answerValue =
        typeof answerEntry?.noul === "number"
          ? answerEntry.noul
          : typeof answerEntry?.score === "number"
            ? answerEntry.score
            : (answerEntry?.choice ?? null);

      const record = {
        id: req.id,
        condition: req.condition ?? null,
        state: req.state,
        questions: req.questions,
        answer: answerValue,
        answers: response.answers,
        probabilities:
          answerEntry?.probabilities ??
          (typeof answerEntry?.noul === "number"
            ? { true: answerEntry.noul, false: 1 - answerEntry.noul }
            : null),
        latencyMs: response.latencyMs,
        fromCache: response.fromCache,
        model: response.model,
        usage: response.usage,
        timestamp: response.timestamp ?? new Date().toISOString(),
      };
      await appendRecord(name, record);
      results.push(record);
      consecutiveFailures = 0;
      if (onResult) onResult(record, item);
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`Item ${req.id} failed:`, err?.message ?? err);
      if (consecutiveFailures >= 50 && !aborted) {
        aborted = new Error(
          `Aborting ${name}: 50 failures among the last completions. Last: ${err?.message ?? err}`,
        );
      }
    }
  }

  // Fire every job at once — core/limiter.js's schedule() queues them and
  // only admits up to its concurrency ceiling at a time, so this is safe and
  // is what actually makes the harness use the 16x concurrency it claims to.
  await Promise.all(pending.map(processOne));

  if (aborted) throw aborted;

  return { results, spentUsd: tracker.spentUsd, liveCalls: tracker.calls };
}
