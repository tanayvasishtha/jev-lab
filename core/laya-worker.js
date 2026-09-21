/**
 * Runs Laya in its own worker thread.
 *
 * Laya does CPU work (tokenising, ONNX inference). Keeping it off the main
 * event loop means a Laya call in progress can't delay the main thread from
 * noticing that a Jev network response has arrived, which would otherwise
 * inflate Jev's measured latency during a side-by-side race.
 */
import { parentPort } from "node:worker_threads";
import os from "node:os";
import { Laya } from "@receptron/laya";

// Physical cores, roughly: measured fastest-per-core on a 12-thread Ryzen,
// and it leaves headroom for the browser and a screen recorder.
const THREADS = Number(process.env.LAYA_THREADS) || Math.max(2, Math.floor(os.cpus().length / 2));
const WARMUP_STATE = "The warm-up passage says the sky is blue on a clear day.";
const WARMUP_QUESTION = { answer: { type: "noul", instructions: "Is the following statement true? the sky is blue" } };

let laya;
try {
  laya = await Laya.load({ sessionOptions: { intraOpNumThreads: THREADS } });
  // The first inference is noticeably slower than steady state; pay that
  // cost here so question 1 of a race isn't penalised for it.
  await laya.systemOne(WARMUP_STATE, WARMUP_QUESTION);
  parentPort.postMessage({ type: "ready", threads: THREADS });
} catch (err) {
  parentPort.postMessage({ type: "failed", error: err?.message ?? String(err) });
}

// One inference at a time; the queue keeps concurrent requests from
// competing for the same cores and making every call slower.
let chain = Promise.resolve();
parentPort.on("message", (msg) => {
  if (msg?.type !== "ask") return;
  chain = chain.then(async () => {
    try {
      const t0 = performance.now();
      const r = await laya.systemOne(msg.state, { answer: msg.question });
      const latencyMs = Math.round(performance.now() - t0);
      parentPort.postMessage({
        type: "result",
        id: msg.id,
        answer: r.answers.answer,
        latencyMs,
        inputTokens: r.usage?.input_tokens ?? 0,
      });
    } catch (err) {
      parentPort.postMessage({ type: "error", id: msg.id, error: err?.message ?? String(err) });
    }
  });
});
