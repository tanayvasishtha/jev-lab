import {
  svgRoot,
  scaleLinear,
  axis,
  label,
  linePath,
  dot,
  bar,
  mount,
} from "../core/ui/chart.js";

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function reliabilityChart(results) {
  const W = 1200, H = 675;
  const M = { top: 40, right: 40, bottom: 70, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const x = scaleLinear([0, 1], [M.left, M.left + plotW]);
  const y = scaleLinear([0, 1], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Reliability diagram across ${results.bins} confidence bins, n=${results.n}. Expected calibration error ${results.ece.toFixed(3)}.`,
  });

  // faint count histogram along the bottom, one bar per bin
  const bins = results.reliability;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const binW = plotW / bins.length;
  for (const b of bins) {
    const h = (b.count / maxCount) * (plotH * 0.18);
    svg.append(
      bar(x(b.lo) + 1, M.top + plotH, binW - 2, h, {
        fill: "var(--reference)",
        opacity: 0.25,
      }),
    );
  }

  // perfect-calibration diagonal
  svg.append(
    linePath(
      [
        { x: x(0), y: y(0) },
        { x: x(1), y: y(1) },
      ],
      { stroke: "var(--reference)", width: 1.5, dash: "5 5" },
    ),
  );
  svg.append(label("perfectly calibrated", x(0.62), y(0.66) - 8, { fill: "var(--muted)", size: 13 }));

  // Per-bin dots against the diagonal, not a connected line: with sparse bins
  // (small n) a connected curve implies a trend across empty gaps that isn't
  // there. Each bin gets a gap segment straight down/up to where "perfectly
  // calibrated" would put it, colored by how big that gap is.
  const nonEmpty = bins.filter((b) => b.count > 0);
  for (const b of nonEmpty) {
    const bx = x((b.lo + b.hi) / 2);
    const measuredY = y(b.accuracy);
    const referenceY = y(b.meanProb);
    const gap = Math.abs(b.accuracy - b.meanProb);
    svg.append(
      linePath(
        [{ x: bx, y: measuredY }, { x: bx, y: referenceY }],
        { stroke: gap > 0.2 ? "var(--attention)" : "var(--measure)", width: 1.5, dash: "2 3" },
      ),
    );
    svg.append(
      dot(bx, measuredY, {
        r: 3 + Math.min(7, b.count * 0.6),
        fill: gap > 0.2 ? "var(--attention)" : "var(--measure)",
      }),
    );
  }

  // axes
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(label(fmtPct(t), x(t), M.top + plotH + 24, { anchor: "middle", mono: true }));
    svg.append(label(fmtPct(t), M.left - 12, y(t) + 4, { anchor: "end", mono: true }));
  }
  svg.append(label("Jev's stated confidence", M.left + plotW / 2, H - 16, { anchor: "middle" }));
  svg.append(
    svgTextVertical("measured accuracy", 24, M.top + plotH / 2),
  );

  return svg;
}

function svgTextVertical(text, x, y) {
  const el = label(text, x, y, { anchor: "middle" });
  el.setAttribute("transform", `rotate(-90 ${x} ${y})`);
  return el;
}

function latencyEntropyChart(results) {
  const { points } = results.latencyVsEntropy;
  const W = 1200, H = 500;
  const M = { top: 30, right: 30, bottom: 60, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const maxLatency = Math.max(...points.map((p) => p.latencyMs)) * 1.05;
  const maxEntropy = Math.max(...points.map((p) => p.entropy)) * 1.1 || 1;

  const x = scaleLinear([0, maxEntropy], [M.left, M.left + plotW]);
  const y = scaleLinear([0, maxLatency], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Scatter of latency against answer entropy across ${results.latencyVsEntropy.n} live calls, mean latency ${Math.round(results.latencyVsEntropy.meanLatencyMs)} milliseconds.`,
  });
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));

  for (const p of points) {
    svg.append(dot(x(p.entropy), y(p.latencyMs), { r: 4, fill: "var(--measure)", opacity: 0.55 }));
  }

  const meanY = y(results.latencyVsEntropy.meanLatencyMs);
  svg.append(
    linePath(
      [{ x: M.left, y: meanY }, { x: M.left + plotW, y: meanY }],
      { stroke: "var(--reference)", width: 1.5, dash: "5 5" },
    ),
  );
  svg.append(
    label(`mean ${Math.round(results.latencyVsEntropy.meanLatencyMs)}ms`, M.left + plotW - 4, meanY - 8, {
      anchor: "end",
      mono: true,
    }),
  );

  svg.append(label("answer entropy (0 = certain)", M.left + plotW / 2, H - 16, { anchor: "middle" }));
  svg.append(svgTextVertical("latency (ms)", 24, M.top + plotH / 2));

  return svg;
}

async function main() {
  const res = await fetch("./results.json");
  const results = await res.json();

  // ECE is the average gap between stated confidence and actual accuracy,
  // so 0.031 reads directly as "off by 3.1 points on average".
  document.getElementById("finding").innerHTML =
    `When Jev says how sure it is, it's off by <span class="figure">${(results.ece * 100).toFixed(1)} points</span> on average. ` +
    `That's across <span class="figure">${results.n.toLocaleString("en-US")}</span> labeled questions ` +
    `(expected calibration error ${results.ece.toFixed(3)}, 95% CI ${results.eceCI95[0].toFixed(3)}–${results.eceCI95[1].toFixed(3)}), ` +
    `and it got <span class="figure">${fmtPct(results.accuracy)}</span> of them right.`;

  mount(document.getElementById("hero-chart"), reliabilityChart(results));
  const nonEmptyBins = results.reliability.filter((b) => b.count > 0);
  const minBinCount = Math.min(...nonEmptyBins.map((b) => b.count));
  const sparseWarning =
    minBinCount <= 3
      ? ` At n=${results.n}, some bins hold only ${minBinCount === 1 ? "1 question" : `${minBinCount} questions`}, so read those individual dots cautiously.`
      : "";
  document.getElementById("hero-caption").textContent =
    `Reliability diagram, ${results.bins} bins, n=${results.n}. Each dot is one confidence bin, sized by how many questions fell in it; ` +
    `the dashed segment shows its distance from the perfectly-calibrated diagonal, coloured red past a 0.2 gap. ` +
    `Bars along the bottom are per-bin counts.${sparseWarning}`;

  mount(document.getElementById("secondary-chart"), latencyEntropyChart(results));
  document.getElementById("secondary-caption").textContent =
    `Latency against answer entropy for the ${results.latencyVsEntropy.n} live (non-cached) calls. ` +
    `Entropy near 0 means Jev was certain; higher entropy means the two options were close.`;

  const meaning = document.getElementById("meaning");
  const gap = Math.abs(results.ece);
  meaning.textContent =
    gap < 0.05
      ? "This is within the calibration TypeSafe claims: when Jev says it's 90% sure, it's right about 90% of the time. That's a real, checkable property, not just a marketing line."
      : `This is looser than TypeSafe's calibration pitch suggests: a ${gap.toFixed(3)} expected calibration error means confident answers aren't as reliable as the stated probability implies. That gap is worth knowing before trusting Jev's probabilities directly in a threshold-based system.`;

  const tbody = document.getElementById("method-body");
  const rows = [
    ["Items", results.n],
    ["Model", results.model],
    ["Seed", results.seed],
    ["Date", new Date(results.finishedAt).toISOString().slice(0, 10)],
    ["Live calls", results.liveCalls],
    ["Cache hits", results.cacheHits],
    ["Estimated cost", `$${results.estimatedCost.toFixed(4)}`],
  ];
  tbody.innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

main().catch((err) => {
  document.getElementById("finding").textContent = `Failed to load results: ${err.message}`;
  console.error(err);
});
