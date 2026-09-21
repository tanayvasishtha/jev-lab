/**
 * Sole module that imports @typesafe-ai/sdk.
 * Experiments must call through runner.js.
 */
import { createHash } from "node:crypto";
import { Agent, setGlobalDispatcher } from "undici";

// The SDK uses the global fetch. Node's default closes an idle connection
// after 4 seconds, so any gap longer than that between Jev calls pays for a
// fresh TLS connection, measured at roughly +800ms per call (about 1200ms vs
// 400ms). In a three-way race with a slow local model, every question has a
// gap that long, which made Jev look twice as slow as it is. A real app that
// calls Jev regularly keeps its connection open, so keep ours open too.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 }));
import {
  TypeSafeClient,
  noul,
  choice,
  score,
  RateLimitError,
  InternalServerError,
  APIConnectionError,
  APITimeoutError,
  APIError,
} from "@typesafe-ai/sdk";

export { noul, choice, score };

/** Pinned model (live systemOne returns model "jev-1.13.0"). */
export const MODEL_ID = "jev-1.13.0";

const MAX_ATTEMPTS = 5;
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 30_000;

// Lazy singleton: constructed on first real call, not at module import time.
// Entry scripts call dotenv's config() in their own top-level body, but ESM
// hoists imports, so a module-level `new TypeSafeClient()` here would run
// before that config() call and fail with "no API key" even when .env is
// correct. Deferring construction until callJev() actually runs avoids that.
let client;
function getClient() {
  if (!client) client = new TypeSafeClient({ defaultModel: MODEL_ID });
  return client;
}

function requestHash({ state, questions, model }) {
  return createHash("sha256")
    .update(JSON.stringify({ state, questions, model }))
    .digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** attempt);
  return Math.min(BACKOFF_MAX_MS, base - base * Math.random() * 0.25);
}

function isRetryable(err) {
  if (err instanceof RateLimitError) return true;
  if (err instanceof InternalServerError) return true;
  if (err instanceof APITimeoutError) return true;
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIError && typeof err.status === "number") {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

/**
 * @param {{ state: unknown, questions: Record<string, unknown>, model?: string }} args
 */
export async function callJev({ state, questions, model = MODEL_ID } = {}) {
  const hash = requestHash({ state, questions, model });
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const t0 = performance.now();
    try {
      const response = await getClient().systemOne({ state, questions, model });
      return {
        model: response.model,
        answers: response.answers,
        usage: response.usage ?? { input_tokens: 0, output_tokens: 0 },
        latencyMs: Math.round(performance.now() - t0),
        requestHash: hash,
      };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          `callJev failed: ${err?.message ?? err} [requestHash=${hash}]`,
          { cause: err },
        );
      }
      await sleep(backoffMs(attempt));
    }
  }
  throw new Error(`callJev exhausted retries [requestHash=${hash}]`, {
    cause: lastErr,
  });
}
