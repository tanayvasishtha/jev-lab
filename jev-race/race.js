import { svgRoot, scaleLinear, axis, label, linePath, dot, mount } from "/core/ui/chart.js";

const COLORS = { jev: "var(--measure)", laya: "var(--series-2)" };
const FALLBACK_COLORS = ["var(--series-3)", "var(--attention)", "var(--ink)"];
// Same frozen phrasing as the calibration audit, so results stay comparable.
const instructionFor = (statement) => `Is the following statement true? ${statement}`;

const el = (id) => document.getElementById(id);
const els = {
  racers: el("racers"), count: el("count"), start: el("start"), stop: el("stop"), status: el("status"),
  ask: el("ask"), customPassage: el("custom-passage"), customStatement: el("custom-statement"),
  stage: el("stage"), stageMeta: el("stage-meta"), stageStatement: el("stage-statement"), stagePassage: el("stage-passage"),
  lanes: el("lanes"), scoreBody: el("score-body"), chart: el("latency-chart"), chartCaption: el("latency-caption"),
};

// ?rec=1 hides the controls and starts on its own, for screen recording.
// ?n=25 sets the question count; ?racers=jev,laya picks who races.
const params = new URLSearchParams(location.search);
const REC = params.get("rec") === "1";
const REC_COUNT = Number(params.get("n")) || 25;
const REC_RACERS = params.get("racers")?.split(",").filter(Boolean) ?? null;
if (REC) document.body.classList.add("rec");
let autoStarted = false;

// Shared time scale for the track bars. Starts at 1s and only grows, so
// bars from earlier questions are always comparable with later ones.
let scaleMs = 1000;

let providers = [];
const selected = new Set();
const stats = {}; // id -> { answered, correct, graded, latencies[], first, cost }
const history = []; // [{ index, results: { id: latencyMs } }]
let running = false;
let stopRequested = false;
let busy = false;

function colorFor(id) {
  if (COLORS[id]) return COLORS[id];
  const i = providers.findIndex((p) => p.id === id);
  return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function setStatus(text, warn = false) {
  els.status.textContent = text;
  els.status.classList.toggle("warn", warn);
}

// ---------- providers ----------
async function loadProviders() {
  const res = await fetch("/api/providers");
  const data = await res.json();
  const firstLoad = providers.length === 0;
  providers = data.providers;
  if (data.machine) document.getElementById("machine").textContent = data.machine;
  for (const p of providers) {
    if (!stats[p.id]) stats[p.id] = { answered: 0, correct: 0, graded: 0, latencies: [], first: 0, cost: 0 };
    const wanted = REC_RACERS ? REC_RACERS.includes(p.id) : true;
    if (firstLoad && wanted && p.status !== "unavailable") selected.add(p.id);
    if (p.status === "unavailable") selected.delete(p.id);
  }
  if (!running) renderRacers();
  renderScoreboard();
  const stillLoading = providers.some((p) => selected.has(p.id) && p.status === "loading");
  if (providers.some((p) => p.status === "loading")) setTimeout(loadProviders, 1500);
  syncButtons();

  if (REC && !autoStarted && !stillLoading && readyRacers().length) {
    autoStarted = true;
    els.count.value = String(REC_COUNT);
    startRace(REC_COUNT);
  }
}

function statusText(p) {
  if (p.status === "loading") return "loading model…";
  if (p.status === "unavailable") return p.kind === "hosted" ? "no API key" : "failed to load";
  return p.kind === "hosted" ? "hosted · network" : "local · CPU";
}

function renderRacers() {
  els.racers.innerHTML = "";
  for (const p of providers) {
    const labelEl = document.createElement("label");
    labelEl.className = "racer";
    labelEl.dataset.status = p.status;
    labelEl.title = p.note;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(p.id);
    input.disabled = p.status === "unavailable" || running;
    input.addEventListener("change", () => {
      if (input.checked) selected.add(p.id);
      else selected.delete(p.id);
      renderedLineup = providers.filter((x) => selected.has(x.id)).map((x) => x.id).join(",");
      renderLanes();
      syncButtons();
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = colorFor(p.id);
    const name = document.createElement("span");
    name.textContent = `${p.name}`;
    const st = document.createElement("span");
    st.className = "racer-status";
    st.textContent = statusText(p);
    labelEl.append(input, swatch, name, st);
    els.racers.append(labelEl);
  }
  // Only rebuild lanes and track when who's racing actually changed.
  // Re-rendering the chips (e.g. to re-enable them after a race) must not
  // wipe the last question's finished bars and answers off the screen.
  const lineup = providers.filter((p) => selected.has(p.id)).map((p) => p.id).join(",");
  if (lineup !== renderedLineup) {
    renderedLineup = lineup;
    renderLanes();
  }
}
let renderedLineup = null;

function readyRacers() {
  return providers.filter((p) => selected.has(p.id) && p.status === "ready");
}

function syncButtons() {
  const ready = readyRacers().length > 0;
  els.start.disabled = running || !ready;
  els.ask.disabled = running || busy || !ready;
  els.stop.disabled = !running;
  els.count.disabled = running;
  if (!running && !busy) {
    const loading = providers.filter((p) => selected.has(p.id) && p.status === "loading");
    if (loading.length) {
      setStatus(`Waiting for ${loading.map((p) => p.name).join(", ")} to finish loading…`);
      waitingMessageShown = true;
    } else if (!ready) {
      setStatus("Select at least one ready racer.");
      waitingMessageShown = true;
    } else if (waitingMessageShown) {
      // Only clear messages this function put there; leave "Race finished."
      // and warnings alone.
      setStatus("");
      waitingMessageShown = false;
    }
  }
}
let waitingMessageShown = false;

// ---------- race track ----------
function renderTrack() {
  const rows = document.getElementById("track-rows");
  rows.innerHTML = "";
  for (const p of providers.filter((x) => selected.has(x.id))) {
    const row = document.createElement("div");
    row.className = "track-row";
    row.id = `track-${p.id}`;
    row.style.setProperty("--lane-color", colorFor(p.id));
    row.innerHTML = `
      <span class="track-name">${p.name}</span>
      <div class="track-bar"><div class="track-fill"></div></div>
      <span class="track-time">–</span>`;
    rows.append(row);
  }
  renderScale();
}

function renderScale() {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${Math.round(f * scaleMs)} ms</span>`).join("");
  document.getElementById("track-scale").innerHTML = `<span></span><div class="ticks">${ticks}</div><span></span>`;
}

function setTrack(id, ms, state) {
  const row = document.getElementById(`track-${id}`);
  if (!row) return;
  row.classList.toggle("pending", state === "pending");
  row.classList.toggle("done", state === "done");
  if (state === "pending") row.classList.remove("first");
  row.querySelector(".track-fill").style.width = `${Math.min(100, (ms / scaleMs) * 100).toFixed(2)}%`;
  row.querySelector(".track-time").textContent = ms == null ? "–" : `${Math.round(ms)} ms`;
}

function growScaleFor(ms) {
  if (ms <= scaleMs * 0.92) return false;
  scaleMs = Math.ceil((ms * 1.25) / 250) * 250;
  renderScale();
  return true;
}

// ---------- lanes ----------
const laneState = {}; // id -> { t0, raf, done }

function renderLanes() {
  renderTrack();
  els.lanes.innerHTML = "";
  for (const p of providers.filter((x) => selected.has(x.id))) {
    const lane = document.createElement("article");
    lane.className = "lane";
    lane.id = `lane-${p.id}`;
    lane.style.setProperty("--lane-color", colorFor(p.id));
    lane.innerHTML = `
      <div class="lane-head">
        <span class="lane-name">${p.name}</span>
        <span class="lane-first">first</span>
      </div>
      <div class="lane-kind">${p.maker} · ${p.kind === "hosted" ? "hosted, over the network" : "open source, on this machine"}</div>
      <div class="lane-timer"><span class="ms">–</span><span class="unit">ms</span></div>
      <div class="lane-answer" aria-live="polite"></div>
      <div class="prob-track" aria-hidden="true"><div class="prob-fill"></div></div>`;
    els.lanes.append(lane);
  }
}

function laneEl(id) {
  return document.getElementById(`lane-${id}`);
}

function startTimer(id) {
  const lane = laneEl(id);
  if (!lane) return;
  lane.classList.add("pending");
  lane.classList.remove("first");
  lane.querySelector(".lane-answer").textContent = "thinking…";
  lane.querySelector(".prob-fill").style.width = "0";
  const msEl = lane.querySelector(".ms");
  const s = { t0: performance.now(), done: false };
  const tick = () => {
    if (s.done) return;
    const elapsed = performance.now() - s.t0;
    msEl.textContent = Math.round(elapsed);
    setTrack(id, elapsed, "pending");
    s.raf = requestAnimationFrame(tick);
  };
  laneState[id] = s;
  tick();
}

function finishLane(id, result, truth) {
  const s = laneState[id];
  if (s) {
    s.done = true;
    cancelAnimationFrame(s.raf);
  }
  const lane = laneEl(id);
  if (!lane) return;
  lane.classList.remove("pending");
  const msEl = lane.querySelector(".ms");
  const answerEl = lane.querySelector(".lane-answer");

  if (result.error) {
    msEl.textContent = "–";
    setTrack(id, null, "done");
    answerEl.innerHTML = `<span class="lane-error"></span>`;
    answerEl.firstChild.textContent = result.error;
    return;
  }

  // Final numbers are the model's own measured time (server side), not the
  // browser's round trip, so the local HTTP hop never counts against anyone.
  msEl.textContent = result.latencyMs;
  setTrack(id, result.latencyMs, "done");
  const p = result.answer?.noul;
  const saysTrue = p >= 0.5;
  const confidence = saysTrue ? p : 1 - p;
  let verdict = "";
  if (truth !== null) {
    verdict = saysTrue === truth
      ? ` <span class="verdict-right">✓ right</span>`
      : ` <span class="verdict-wrong">✗ wrong</span>`;
  }
  answerEl.innerHTML = `${saysTrue ? "TRUE" : "FALSE"} ${(confidence * 100).toFixed(1)}%${verdict}`;
  lane.querySelector(".prob-fill").style.width = `${(confidence * 100).toFixed(1)}%`;
}

// ---------- asking ----------
async function ask(providerId, state, statement) {
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, state, question: { type: "noul", instructions: instructionFor(statement) } }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

/** Ask every ready racer at once. truth is true/false for dataset questions, null for custom ones. */
async function runQuestion({ passage, statement, truth, meta }) {
  els.stage.hidden = false;
  els.stageMeta.textContent = meta;
  els.stageStatement.textContent = statement.charAt(0).toUpperCase() + statement.slice(1) + "?";
  els.stagePassage.textContent = passage;

  const racers = readyRacers();
  for (const p of racers) startTimer(p.id);

  const results = await Promise.all(
    racers.map(async (p) => {
      const r = await ask(p.id, passage, statement);
      finishLane(p.id, r, truth);
      return [p.id, r];
    }),
  );

  const ok = results.filter(([, r]) => !r.error);
  if (ok.length > 1) {
    const [winner] = ok.reduce((a, b) => (b[1].latencyMs < a[1].latencyMs ? b : a));
    laneEl(winner)?.classList.add("first");
    document.getElementById(`track-${winner}`)?.classList.add("first");
    stats[winner].first += 1;
  }
  // If anyone ran past the end of the track, widen the scale and redraw the
  // finished bars so they stay truthful against the new scale.
  if (growScaleFor(Math.max(0, ...ok.map(([, r]) => r.latencyMs)))) {
    for (const [id, r] of ok) setTrack(id, r.latencyMs, "done");
  }

  const row = { index: history.length + 1, results: {} };
  for (const [id, r] of results) {
    if (r.error) {
      if (/cap reached/i.test(r.error)) setStatus(r.error, true);
      continue;
    }
    const s = stats[id];
    s.answered += 1;
    s.latencies.push(r.latencyMs);
    s.cost += r.costUsd ?? 0;
    if (truth !== null) {
      s.graded += 1;
      if ((r.answer.noul >= 0.5) === truth) s.correct += 1;
    }
    row.results[id] = r.latencyMs;
  }
  history.push(row);
  renderScoreboard();
  renderChart();
}

// ---------- scoreboard + chart ----------
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function renderScoreboard() {
  els.scoreBody.innerHTML = providers
    .map((p) => {
      const s = stats[p.id];
      const med = median(s.latencies);
      const acc = s.graded ? `${((s.correct / s.graded) * 100).toFixed(1)}% <span class="dim">(${s.correct}/${s.graded})</span>` : "–";
      const cost = p.kind === "local" ? "$0 (local)" : `$${s.cost.toFixed(5)}`;
      return `<tr>
        <td><span class="swatch" style="background:${colorFor(p.id)}"></span>${p.name}</td>
        <td>${s.answered}</td>
        <td>${acc}</td>
        <td>${med === null ? "–" : `${med} ms`}</td>
        <td>${s.first}</td>
        <td>${cost}</td>
      </tr>`;
    })
    .join("");
}

function renderChart() {
  const ids = providers.map((p) => p.id).filter((id) => history.some((h) => h.results[id] != null));
  if (!history.length || !ids.length) return;

  // Wider, shorter shape in recording mode so it fits the 1080p frame at a
  // readable size instead of being scaled down.
  const W = 1200, H = REC ? 190 : 420;
  const M = REC ? { top: 14, right: 150, bottom: 30, left: 70 } : { top: 24, right: 110, bottom: 50, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const all = history.flatMap((h) => Object.values(h.results));
  const maxMs = Math.max(50, ...all) * 1.1;
  const x = scaleLinear([1, Math.max(2, history.length)], [M.left, M.left + plotW]);
  const y = scaleLinear([0, maxMs], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Latency per question for ${ids.map((id) => providers.find((p) => p.id === id).name).join(" and ")} across ${history.length} questions.`,
  });
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));
  for (const t of [0, 0.5, 1]) {
    const v = Math.round(t * maxMs);
    svg.append(label(`${v} ms`, M.left - 10, y(v) + 4, { anchor: "end", mono: true, size: 12 }));
  }
  if (!REC) svg.append(label("question #", M.left + plotW / 2, H - 12, { anchor: "middle" }));
  svg.append(label(String(history.length), x(history.length), M.top + plotH + 20, { anchor: "middle", mono: true, size: 12 }));
  svg.append(label("1", x(1), M.top + plotH + 20, { anchor: "middle", mono: true, size: 12 }));

  for (const id of ids) {
    const pts = history.filter((h) => h.results[id] != null).map((h) => ({ x: x(h.index), y: y(h.results[id]) }));
    const color = colorFor(id);
    if (pts.length > 1) svg.append(linePath(pts, { stroke: color, width: 2 }));
    for (const p of pts) svg.append(dot(p.x, p.y, { r: 3.5, fill: color }));
    const last = pts[pts.length - 1];
    const name = providers.find((p) => p.id === id).name;
    svg.append(label(`${name} ${median(stats[id].latencies)} ms`, last.x + 10, last.y + 4, { fill: color, mono: true, size: 13 }));
  }

  mount(els.chart, svg);
  els.chartCaption.textContent = `One point per question. The label at the end of each line is that model's median latency so far, n=${history.length}.`;
}

// ---------- race loop ----------
async function startRace(count) {
  const n = count ?? Number(els.count.value);
  running = true;
  stopRequested = false;
  renderRacers();
  syncButtons();
  setStatus("Loading questions…");

  const seed = Math.floor(Math.random() * 1_000_000) + 1;
  const res = await fetch(`/api/questions?n=${n}&seed=${seed}`);
  const { items } = await res.json();

  for (let i = 0; i < items.length; i++) {
    if (stopRequested) break;
    if (document.hidden) {
      setStatus("Paused because the tab was hidden. Press Start to race again.", true);
      break;
    }
    if (!readyRacers().length) break;
    const item = items[i];
    setStatus(`Question ${i + 1} of ${items.length}`);
    await runQuestion({
      passage: item.passage,
      statement: item.question,
      truth: item.label,
      meta: `Question ${i + 1} of ${items.length} · BoolQ ${item.id} · true answer: ${item.label ? "TRUE" : "FALSE"}`,
    });
    if (/cap reached/i.test(els.status.textContent)) break;
    await new Promise((r) => setTimeout(r, 450));
  }

  running = false;
  if (!els.status.classList.contains("warn")) setStatus(stopRequested ? "Stopped." : "Race finished.");
  if (!stopRequested && history.length) {
    // The status line is hidden in recording mode, so mark the finish where
    // the camera can see it.
    els.stageMeta.textContent = `Race finished · ${history.length} questions · last one shown below`;
  }
  renderRacers();
  syncButtons();
}

async function askCustom() {
  const passage = els.customPassage.value.trim();
  const statement = els.customStatement.value.trim();
  if (!passage || !statement) {
    setStatus("Add a passage and a statement first.", true);
    return;
  }
  busy = true;
  syncButtons();
  setStatus("Asking…");
  await runQuestion({ passage, statement, truth: null, meta: "Your question · no answer key, so no right or wrong" });
  busy = false;
  setStatus("");
  syncButtons();
}

els.start.addEventListener("click", () => {
  setStatus("");
  els.status.classList.remove("warn");
  startRace();
});
els.stop.addEventListener("click", () => {
  stopRequested = true;
  setStatus("Stopping after this question…");
});
els.ask.addEventListener("click", askCustom);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) stopRequested = true;
});

loadProviders().catch((err) => setStatus(`Could not reach the race server: ${err.message}`, true));
