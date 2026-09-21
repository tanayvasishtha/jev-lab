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

function startLayaWorker() {
  if (layaWorker) return;
  layaWorker = new Worker(new URL("./laya-worker.js", import.meta.url));
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

export const PROVIDERS = { jev, laya };

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
