/**
 * Runs Laya in its own child process (started by core/providers.js).
 *
 * Laya does CPU work (tokenising, ONNX inference). Running it outside the
 * race server's process means:
 *   - its CPU work can't delay the main event loop that times Jev's network
 *     calls, and
 *   - if ONNX Runtime crashes natively (for example when the machine runs
 *     short of memory), only this process dies. The race server stays up,
 *     reports Laya as unavailable, and starts a fresh copy.
 *
 * Talks to its parent over the IPC channel from child_process.fork().
 */
import { Laya } from "@receptron/laya";

const THREADS = Number(process.env.LAYA_WORKER_THREADS) || 4;
const MODEL_DIR = process.env.LAYA_WORKER_MODEL_DIR || undefined; // unset = stock bundle
const WARMUP_STATE = "The warm-up passage says the sky is blue on a clear day.";
const WARMUP_QUESTION = { answer: { type: "noul", instructions: "Is the following statement true? the sky is blue" } };

const send = (msg) => process.send?.(msg);

// Exit with the parent: if the race server goes away, don't leave ~2GB of
// model sitting in memory.
process.on("disconnect", () => process.exit(0));

let laya;
try {
  laya = await Laya.load({ ...(MODEL_DIR ? { modelDir: MODEL_DIR } : {}), sessionOptions: { intraOpNumThreads: THREADS } });
  // The first inference is noticeably slower than steady state; pay that
  // cost here so question 1 of a race isn't penalised for it.
  await laya.systemOne(WARMUP_STATE, WARMUP_QUESTION);
  send({ type: "ready", threads: THREADS });
} catch (err) {
  send({ type: "failed", error: err?.message ?? String(err) });
  process.exit(1);
}

// One inference at a time; the queue keeps concurrent requests from
// competing for the same cores and making every call slower.
let chain = Promise.resolve();
process.on("message", (msg) => {
  if (msg?.type !== "ask") return;
  chain = chain.then(async () => {
    try {
      const t0 = performance.now();
      const r = await laya.systemOne(msg.state, { answer: msg.question });
      const latencyMs = Math.round(performance.now() - t0);
      send({ type: "result", id: msg.id, answer: r.answers.answer, latencyMs, inputTokens: r.usage?.input_tokens ?? 0 });
    } catch (err) {
      send({ type: "error", id: msg.id, error: err?.message ?? String(err) });
    }
  });
});
