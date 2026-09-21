/**
 * Decision-model providers behind one interface, for jev-race.
 *
 * ask({ state, question }) -> { provider, model, answer, latencyMs, inputTokens, costUsd }
 * `question` is a plain typed question, the shape both Jev and Laya accept:
 *   { type: "noul", instructions }
 *   { type: "choice", instructions, criteria: { key: description } }
 *   { type: "score", instructions, criteria: [levels] }
 *
 * Adding a competitor means adding one entry to PROVIDERS below.
 */
import { Worker } from "node:worker_threads";
import os from "node:os";
import { callJev, MODEL_ID, noul, choice, score } from "./client.js";
import { estimateCostUsd } from "./budget.js";

function toJevQuestion(q) {
  if (q.type === "noul") return noul(q.instructions);
  if (q.type === "choice") return choice(q.instructions, q.criteria);
  if (q.type === "score") return score(q.instructions, q.criteria);
  throw new Error(`Unsupported question type: ${q.type}`);
}

// ---------- Jev (hosted, TypeSafe API) ----------
const jev = {
  id: "jev",
  name: "Jev",
  maker: "TypeSafe",
  kind: "hosted",
  note: "Hosted API. Latency includes the network round trip to TypeSafe.",
  status: () => (process.env.TYPESAFE_API_KEY ? "ready" : "unavailable"),
  async ask({ state, question }) {
    const r = await callJev({ state, questions: { answer: toJevQuestion(question) } });
    const inputTokens = r.usage?.input_tokens ?? 0;
    return {
      model: r.model ?? MODEL_ID,
      answer: r.answers.answer,
      latencyMs: r.latencyMs,
      inputTokens,
      costUsd: estimateCostUsd(inputTokens),
    };
  },
};

// ---------- Laya (open source, runs on this machine) ----------
// Lives in a worker thread (see laya-worker.js) so its CPU work can't stall
// the main event loop that's timing Jev's network calls.
let layaWorker = null;
let layaStatus = "loading";
let layaError = null;
let nextId = 0;
const pendingLaya = new Map();

// Half the CPU threads: Laya and Von are both local and race at the same
// moment, so each gets an equal half of the machine (Von's launcher,
// jev-race/start-von.py, uses the same half). Override with LAYA_THREADS.
const LAYA_THREADS = Number(process.env.LAYA_THREADS) || Math.max(2, Math.floor(os.cpus().length / 2));

function startLayaWorker() {
  if (layaWorker) return;
  layaWorker = new Worker(new URL("./laya-worker.js", import.meta.url), { workerData: { threads: LAYA_THREADS } });
  layaWorker.on("message", (msg) => {
    if (msg.type === "ready") layaStatus = "ready";
    else if (msg.type === "failed") {
      layaStatus = "unavailable";
      layaError = msg.error;
    } else {
      const pending = pendingLaya.get(msg.id);
      if (!pending) return;
      pendingLaya.delete(msg.id);
      if (msg.type === "error") pending.reject(new Error(msg.error));
      else pending.resolve(msg);
    }
  });
  layaWorker.on("error", (err) => {
    layaStatus = "unavailable";
    layaError = err?.message ?? String(err);
    for (const p of pendingLaya.values()) p.reject(new Error(`Laya worker crashed: ${layaError}`));
    pendingLaya.clear();
  });
}

const laya = {
  id: "laya",
  name: "Laya",
  maker: "Convai Innovations",
  kind: "local",
  note: "Open source (Apache 2.0). Runs on this machine's CPU, no network, no per-call cost.",
  status: () => layaStatus,
  error: () => layaError,
  warm: () => startLayaWorker(),
  async ask({ state, question }) {
    startLayaWorker();
    if (layaStatus !== "ready") throw new Error(layaStatus === "loading" ? "Laya is still loading" : `Laya unavailable: ${layaError}`);
    const id = ++nextId;
    const msg = await new Promise((resolve, reject) => {
      pendingLaya.set(id, { resolve, reject });
      layaWorker.postMessage({ type: "ask", id, state, question });
    });
    return {
      model: "convaiinnovations/laya",
      answer: msg.answer,
      latencyMs: msg.latencyMs,
      inputTokens: msg.inputTokens,
      costUsd: 0,
    };
  },
};

// ---------- Von (open source, local Python server) ----------
// Von ships as a Python server that speaks Jev's /v1/systemone format.
// Start it with `npm run von` (binds 127.0.0.1:8000). It runs in its own
// process, so like Laya's worker it can't stall this event loop.
const VON_URL = process.env.VON_URL || "http://127.0.0.1:8000";
let vonStatus = "unavailable";
let vonWarming = false;
let vonEverReady = false;
let vonMisses = 0;

async function checkVon() {
  if (vonWarming) return;
  try {
    // Generous timeout: while Von is busy answering a race question its
    // health endpoint can be slow to respond, and a busy racer must not be
    // mistaken for a dead one.
    await fetch(VON_URL, { signal: AbortSignal.timeout(5000) });
    vonMisses = 0;
  } catch {
    vonMisses += 1;
    if (vonMisses >= 3) vonStatus = "unavailable"; // three misses in a row, ~15s
    return;
  }
  if (vonStatus === "ready") return;
  // Reachable but cold: the first request loads the weights, which can take
  // a while. Warm it once so question 1 of a race isn't penalised for it.
  vonWarming = true;
  vonStatus = "loading";
  try {
    await askVonRaw(
      "The warm-up passage says the sky is blue on a clear day.",
      { type: "noul", instructions: "Is the following statement true? the sky is blue" },
      600_000,
    );
    vonStatus = "ready";
    vonEverReady = true;
  } catch {
    vonStatus = "unavailable";
  } finally {
    vonWarming = false;
  }
}

async function askVonRaw(state, question, timeoutMs = 60_000) {
  const res = await fetch(`${VON_URL}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, questions: { answer: question } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Von HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const von = {
  id: "von",
  name: "Von",
  maker: "wfzyx",
  kind: "local",
  note: "Open source (Apache 2.0). Local Python server on this machine's CPU. Start it with `npm run von`.",
  status: () => vonStatus,
  warm: () => {
    checkVon();
    setInterval(checkVon, 5000).unref();
  },
  async ask({ state, question }) {
    // Once Von has been ready, always send the question and let a real
    // failure surface, instead of trusting a health check that may be stale.
    if (!vonEverReady) throw new Error(vonStatus === "loading" ? "Von is still loading" : "Von server not running (npm run von)");
    const t0 = performance.now();
    const r = await askVonRaw(state, question);
    const latencyMs = Math.round(performance.now() - t0);
    return {
      model: r.model ?? "von",
      answer: r.answers.answer,
      latencyMs,
      inputTokens: r.usage?.input_tokens ?? 0,
      costUsd: 0,
    };
  },
};

export const PROVIDERS = { jev, laya, von };

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    maker: p.maker,
    kind: p.kind,
    note: p.note,
    status: p.status(),
  }));
}

export function warmAll() {
  for (const p of Object.values(PROVIDERS)) if (p.warm) p.warm();
}
