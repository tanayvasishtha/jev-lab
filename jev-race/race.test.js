/**
 * jev-race tests. No models are loaded and no paid API calls are made:
 * the server under test runs with only the Jev racer, no Jev key, and a $0
 * spend cap, so every request is answered by validation or the cap guard.
 *
 * Run: npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { median, pickWinner, isCorrect, nextScale, validQuestion } from "./shared.js";

// ---------- pure logic ----------

test("median handles odd, even, empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 3); // (2+3)/2 = 2.5, rounded
  assert.equal(median([]), null);
});

test("pickWinner uses measured latency, ignores errors, needs two finishers", () => {
  assert.equal(pickWinner([["jev", { latencyMs: 400 }], ["laya", { latencyMs: 900 }]]), "jev");
  assert.equal(pickWinner([["jev", { latencyMs: 400 }], ["laya", { latencyMs: 90 }]]), "laya");
  assert.equal(pickWinner([["jev", { error: "x" }], ["laya", { latencyMs: 900 }], ["von", { latencyMs: 2000 }]]), "laya");
  assert.equal(pickWinner([["jev", { latencyMs: 400 }], ["laya", { error: "down" }]]), null);
  assert.equal(pickWinner([]), null);
});

test("isCorrect thresholds at 0.5", () => {
  assert.equal(isCorrect(0.5, true), true);
  assert.equal(isCorrect(0.49, false), true);
  assert.equal(isCorrect(0.9, false), false);
});

test("nextScale only grows, and only near the edge", () => {
  assert.equal(nextScale(1000, 500), 1000);
  assert.equal(nextScale(1000, 920), 1000);
  assert.equal(nextScale(1000, 1200), 1500); // 1200*1.25 = 1500
  assert.equal(nextScale(1500, 100), 1500); // never shrinks
});

test("validQuestion accepts the three typed shapes and rejects junk", () => {
  assert.equal(validQuestion({ type: "noul", instructions: "Is it true?" }), true);
  assert.equal(validQuestion({ type: "choice", instructions: "Which?", criteria: { a: "x", b: "y" } }), true);
  assert.equal(validQuestion({ type: "score", instructions: "How?", criteria: ["low", "high"] }), true);
  assert.equal(validQuestion({ type: "choice", instructions: "Which?", criteria: { a: "x" } }), false);
  assert.equal(validQuestion({ type: "choice", instructions: "Which?", criteria: ["a", "b"] }), false);
  assert.equal(validQuestion({ type: "noul", instructions: "   " }), false);
  assert.equal(validQuestion({ type: "noul", instructions: "x".repeat(1001) }), false);
  assert.equal(validQuestion({ type: "generate", instructions: "write a poem" }), false);
  assert.equal(validQuestion(null), false);
});

// ---------- server ----------

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  server = spawn(process.execPath, [path.join(root, "jev-race", "server.js")], {
    env: { ...process.env, RACE_PORT: String(PORT), RACE_PROVIDERS: "jev", RACE_JEV_CAP_USD: "0", TYPESAFE_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("race server did not start")), 15000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("jev-race on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`race server exited early (${code})`)));
  });
});

after(() => server?.kill());

const ask = (body) =>
  fetch(`${BASE}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("serves the page and its assets", async () => {
  for (const p of ["/", "/race.js", "/race.css", "/shared.js", "/core/ui/lab.css", "/core/ui/chart.js"]) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 200, p);
  }
});

test("never serves anything outside the allowlist", async () => {
  for (const p of ["/.env", "/package.json", "/core/client.js", "/jev-race/server.js", "/..%2F.env", "/data/raw/jev-label-bias.jsonl"]) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /TYPESAFE_API_KEY|apikey_/, p);
  }
});

test("lists only the enabled racers, plus the machine name", async () => {
  const data = await (await fetch(`${BASE}/api/providers`)).json();
  assert.deepEqual(data.providers.map((p) => p.id), ["jev"]);
  assert.equal(data.providers[0].status, "unavailable"); // no key in this test
  assert.equal(typeof data.machine, "string");
});

test("rejects bad asks before touching any model", async () => {
  const q = { type: "noul", instructions: "Is it true?" };
  assert.equal((await ask({ provider: "nope", state: "s", question: q })).status, 400);
  assert.equal((await ask({ provider: "jev", state: "", question: q })).status, 400);
  assert.equal((await ask({ provider: "jev", state: "s", question: { type: "noul" } })).status, 400);
});

test("the spend cap blocks Jev before any paid call", async () => {
  const res = await ask({ provider: "jev", state: "The sky is blue.", question: { type: "noul", instructions: "Is it true? the sky is blue" } });
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /cap reached/);
});

test("refuses oversized request bodies", async () => {
  const res = await ask({ provider: "jev", state: "x".repeat(70 * 1024), question: { type: "noul", instructions: "?" } });
  assert.equal(res.status, 413);
});
