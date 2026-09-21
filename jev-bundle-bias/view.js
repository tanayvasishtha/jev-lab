import { svgRoot, scaleLinear, axis, label, dot, mount } from "../core/ui/chart.js";

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

/** One dot per paired comparison: position on x, |shift| on y, red if it flipped. */
function shiftByPositionChart(raw) {
  const W = 1200, H = 675;
  const M = { top: 30, right: 30, bottom: 60, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const x = scaleLinear([0, 9], [M.left, M.left + plotW]);
  const maxShift = Math.max(0.05, ...raw.map((r) => r.shift)) * 1.1;
  const y = scaleLinear([0, maxShift], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Scatter of ${raw.length} alone-versus-bundled comparisons by the target question's position in the bundle. Red dots crossed the decision boundary.`,
  });
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));

  for (let p = 0; p <= 9; p++) {
    svg.append(label(String(p), x(p), M.top + plotH + 22, { anchor: "middle", mono: true, size: 12 }));
  }
  for (const t of [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxShift)) {
    svg.append(label(t.toFixed(2), M.left - 12, y(t) + 4, { anchor: "end", mono: true, size: 12 }));
  }

  for (const r of raw) {
    const jitterX = x(r.position) + (Math.random() - 0.5) * (plotW / 10) * 0.5;
    svg.append(
      dot(jitterX, y(r.shift), {
        r: 4,
        fill: r.flipped ? "var(--attention)" : "var(--measure)",
        opacity: r.flipped ? 0.85 : 0.35,
      }),
    );
  }

  svg.append(label("target's position within the 10-question bundle (0 = first, 9 = last)", M.left + plotW / 2, H - 16, { anchor: "middle" }));
  svg.append(label("probability shift, alone → bundled", M.left - 50, M.top - 8, { anchor: "start", size: 13 }));

  return svg;
}

function compositionBarChart(breakdown) {
  const W = 1200, H = 400;
  const M = { top: 30, right: 30, bottom: 50, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const entries = Object.entries(breakdown);
  const maxShift = Math.max(0.02, ...entries.map(([, d]) => d.meanShift)) * 1.2;
  const x = scaleLinear([0, entries.length], [M.left, M.left + plotW]);
  const y = scaleLinear([0, maxShift], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Bar chart of mean probability shift across ${entries.length} independent bundle compositions.`,
  });
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));

  entries.forEach(([idx, d], i) => {
    const barW = (plotW / entries.length) * 0.4;
    const cx = x(i) + (plotW / entries.length) / 2;
    const h = M.top + plotH - y(d.meanShift);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", cx - barW / 2);
    rect.setAttribute("y", y(d.meanShift));
    rect.setAttribute("width", barW);
    rect.setAttribute("height", h);
    rect.setAttribute("fill", "var(--measure)");
    rect.setAttribute("opacity", "0.7");
    svg.append(rect);
    svg.append(label(`composition ${idx}`, cx, M.top + plotH + 24, { anchor: "middle", size: 12 }));
    svg.append(label(d.meanShift.toFixed(4), cx, y(d.meanShift) - 8, { anchor: "middle", mono: true, size: 12 }));
  });

  svg.append(label("mean |shift| by bundle composition", M.left, M.top - 10, { anchor: "start", size: 13 }));
  return svg;
}

async function main() {
  const [res, rawRes] = await Promise.all([fetch("./results.json"), fetch("../data/raw/jev-bundle-bias.jsonl")]);
  const results = await res.json();
  const rawText = await rawRes.text();

  // Rebuild per-comparison points (position, shift, flipped) straight from the
  // raw JSONL so the chart matches exactly what analyze.js computed from.
  const records = rawText.split(/\n+/).filter(Boolean).map((l) => JSON.parse(l));
  const byTarget = new Map();
  for (const rec of records) {
    const tId = rec.id.split("__")[0];
    if (!byTarget.has(tId)) byTarget.set(tId, { alone: null, bundled: [] });
    const entry = byTarget.get(tId);
    if (rec.condition === "alone") entry.alone = rec.answer;
    else entry.bundled.push({ position: rec.targetPosition, noul: rec.answers[rec.targetKey].noul });
  }
  const points = [];
  for (const { alone, bundled } of byTarget.values()) {
    if (alone == null) continue;
    for (const b of bundled) {
      points.push({
        position: b.position,
        shift: Math.abs(b.noul - alone),
        flipped: (alone >= 0.5) !== (b.noul >= 0.5),
      });
    }
  }

  document.getElementById("finding").innerHTML =
    `Bundling a question with 9 unrelated ones flips Jev's answer <span class="figure">${fmtPct(results.flipRate)}</span> of the time ` +
    `(95% CI ${fmtPct(results.flipRateCI95[0])}–${fmtPct(results.flipRateCI95[1])}), across <span class="figure">${results.pairedComparisons.toLocaleString("en-US")}</span> paired comparisons ` +
    `over <span class="figure">${results.completeTargets.toLocaleString("en-US")}</span> questions, with a mean probability shift of <span class="figure">${results.meanAbsShift.toFixed(3)}</span>.`;

  mount(document.getElementById("hero-chart"), shiftByPositionChart(points));
  document.getElementById("hero-caption").textContent =
    `Every dot is one alone-vs-bundled comparison (n=${points.length}). Red dots crossed the 0.5 decision boundary; the x position is jittered for readability, ` +
    `the underlying position value is exact.`;

  mount(document.getElementById("secondary-chart"), compositionBarChart(results.compositionBreakdown));
  document.getElementById("secondary-caption").textContent =
    `Mean absolute probability shift for each of the 3 independently-drawn bundle compositions, pooled across all targets and positions.`;

  const meaning = document.getElementById("meaning");
  meaning.textContent =
    results.flipRate < 0.05
      ? `This supports the preregistered hypothesis: bundling a question with 9 unrelated ones doesn't meaningfully change its answer. You can bundle questions for the speed and cost benefit without worrying it contaminates the result.`
      : `This is a real cost of bundling: at a ${fmtPct(results.flipRate)} flip rate, some fraction of answers depend on what else is in the same call, not just the question itself. Worth checking against your own bundle sizes before relying on Jev's parallel-question feature for anything decision-critical.`;

  const rows = [
    ["Target questions", results.completeTargets],
    ["Paired comparisons", results.pairedComparisons],
    ["Model", results.model],
    ["Seed", results.seed],
    ["Date", new Date(results.finishedAt).toISOString().slice(0, 10)],
    ["McNemar p-value", results.mcnemar.pValue.toFixed(4)],
    ["Cache hits", results.cacheHits],
    ["Estimated cost", `$${results.estimatedCost.toFixed(4)}`],
  ];
  document.getElementById("method-body").innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

main().catch((err) => {
  document.getElementById("finding").textContent = `Failed to load results: ${err.message}`;
  console.error(err);
});
