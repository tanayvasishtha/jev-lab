/**
 * jev-race: live, side-by-side race between decision models.
 * Usage: npm run race   (then open http://localhost:4100)
 *
 * Local only. Binds 127.0.0.1 and never serves anything outside the page
 * assets, since the Jev key lives in this process's environment.
 */
import http from "node:http";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { validQuestion } from "./shared.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

// Imported after dotenv so the Jev client sees the key.
const { PROVIDERS, listProviders, warmAll } = await import("../core/providers.js");
const { loadBoolQ, sample } = await import("../core/datasets.js");

const PORT = Number(process.env.RACE_PORT) || 4100;
const HOST = "127.0.0.1";
// Hard cap on real Jev spend for the lifetime of this server process.
const JEV_CAP_USD = process.env.RACE_JEV_CAP_USD !== undefined ? Number(process.env.RACE_JEV_CAP_USD) : 0.5;
const MAX_STATE_CHARS = 6000;
const MAX_QUESTIONS_PER_REQUEST = 100;

let jevSpentUsd = 0;
let jevCalls = 0;

// Only these files are ever served. Everything else is a 404.
const STATIC = {
  "/": ["jev-race/index.html", "text/html"],
  "/index.html": ["jev-race/index.html", "text/html"],
  "/race.js": ["jev-race/race.js", "text/javascript"],
  "/race.css": ["jev-race/race.css", "text/css"],
  "/core/ui/lab.css": ["core/ui/lab.css", "text/css"],
  "/core/ui/chart.js": ["core/ui/chart.js", "text/javascript"],
  "/shared.js": ["jev-race/shared.js", "text/javascript"],
};

let boolqCache = null;
async function boolq() {
  if (!boolqCache) boolqCache = await loadBoolQ();
  return boolqCache;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleAsk(req, res) {
  const body = await readBody(req);
  const provider = PROVIDERS[body.provider];
  if (!provider) return send(res, 400, { error: `Unknown provider: ${body.provider}` });
  if (typeof body.state !== "string" || !body.state.trim()) return send(res, 400, { error: "state is required" });
  if (!validQuestion(body.question)) return send(res, 400, { error: "question is invalid" });
  const state = body.state.slice(0, MAX_STATE_CHARS);

  if (provider.id === "jev" && jevSpentUsd >= JEV_CAP_USD) {
    return send(res, 402, {
      error: `Jev spend cap reached for this session ($${jevSpentUsd.toFixed(4)} of $${JEV_CAP_USD.toFixed(2)}). Restart the server or raise RACE_JEV_CAP_USD.`,
    });
  }

  try {
    const result = await provider.ask({ state, question: body.question });
    if (provider.id === "jev") {
      jevSpentUsd += result.costUsd;
      jevCalls += 1;
    }
    send(res, 200, { provider: provider.id, ...result, jevSpentUsd, jevCapUsd: JEV_CAP_USD });
  } catch (err) {
    send(res, 502, { error: err?.message ?? String(err) });
  }
}

async function handleQuestions(url, res) {
  const n = Math.min(MAX_QUESTIONS_PER_REQUEST, Math.max(1, Number(url.searchParams.get("n")) || 25));
  const seed = Number(url.searchParams.get("seed")) || 7;
  const items = sample(await boolq(), n, seed).map((row) => ({
    id: row.id,
    passage: row.passage,
    question: row.question,
    label: row.label,
  }));
  // A race is starting. Open Jev's connection now with one tiny call, so
  // question 1 isn't charged ~800ms of TLS setup that later questions don't
  // pay. Costs a fraction of a cent and counts toward the session cap.
  await warmJev();
  send(res, 200, { seed, items });
}

async function warmJev() {
  const jev = PROVIDERS.jev;
  if (!jev || jev.status() !== "ready" || jevSpentUsd >= JEV_CAP_USD) return;
  try {
    const r = await jev.ask({ state: "Warm-up.", question: { type: "noul", instructions: "Is this a warm-up?" } });
    jevSpentUsd += r.costUsd;
    jevCalls += 1;
  } catch {
    /* a failed warm-up just means question 1 may be slower */
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/api/providers") {
      return send(res, 200, {
        providers: listProviders(),
        jevSpentUsd,
        jevCapUsd: JEV_CAP_USD,
        jevCalls,
        machine: os.cpus()[0]?.model?.trim() ?? "this machine",
      });
    }
    if (req.method === "GET" && url.pathname === "/api/questions") return await handleQuestions(url, res);
    if (req.method === "POST" && url.pathname === "/api/ask") return await handleAsk(req, res);

    const entry = req.method === "GET" && STATIC[url.pathname];
    if (entry) {
      const [file, type] = entry;
      return send(res, 200, await fs.readFile(path.join(ROOT, file)), type);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, err?.status ?? 500, { error: err?.message ?? String(err) });
  }
});

// This process times Jev's network calls. When Laya and Von are crunching
// on every core, a normal-priority process gets starved and notices Jev's
// responses late, which measured Jev at ~800ms instead of the ~370ms its API
// actually takes. Running just this (lightweight) process slightly above
// normal keeps Jev's timing honest; Laya's child process is put back to
// normal priority in core/providers.js, so the local models still compete
// with each other on equal terms.
try {
  os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
} catch {
  /* not permitted on this OS/user; timings may read slightly high */
}

server.listen(PORT, HOST, () => {
  console.log(`jev-race on http://localhost:${PORT}  (Jev spend cap $${JEV_CAP_USD.toFixed(2)} per session)`);
  warmAll(); // start loading local models in the background
});
