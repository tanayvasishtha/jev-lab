import { svgRoot, scaleLinear, axis, label, linePath, dot, mount } from "../core/ui/chart.js";

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function accuracyCurve(results) {
  const W = 1200, H = 675;
  const M = { top: 40, right: 40, bottom: 60, left: 70 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const sizes = results.sizes;
  const accs = sizes.map((s) => results.perSize[s].accuracyMean);
  const lo = Math.min(...accs) - 0.01;
  const hi = Math.max(...accs) + 0.01;

  // log scale on x since sizes span 1 to 100
  const logSizes = sizes.map((s) => Math.log10(s));
  const x = scaleLinear([logSizes[0], logSizes[logSizes.length - 1]], [M.left, M.left + plotW]);
  const y = scaleLinear([lo, hi], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H);
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  svg.append(axis({ x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH }));

  sizes.forEach((s, i) => {
    svg.append(label(String(s), x(logSizes[i]), M.top + plotH + 22, { anchor: "middle", mono: true, size: 12 }));
  });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const v = lo + t * (hi - lo);
    svg.append(label(fmtPct(v), M.left - 12, y(v) + 4, { anchor: "end", mono: true, size: 12 }));
  }

  const points = sizes.map((s, i) => ({ x: x(logSizes[i]), y: y(accs[i]) }));
  svg.append(linePath(points, { stroke: "var(--measure)", width: 2.5 }));
  points.forEach((p, i) => {
    const isSaturation = sizes[i] === results.saturationSize;
    svg.append(dot(p.x, p.y, { r: isSaturation ? 7 : 4.5, fill: isSaturation ? "var(--attention)" : "var(--measure)" }));
  });

  const satIdx = sizes.indexOf(results.saturationSize);
  if (satIdx >= 0) {
    svg.append(
      label(`saturates at ${results.saturationSize}`, points[satIdx].x, points[satIdx].y - 16, {
        anchor: "middle",
        fill: "var(--attention)",
        size: 13,
      }),
    );
  }

  svg.append(label("ensemble size (log scale)", M.left + plotW / 2, H - 16, { anchor: "middle" }));
  svg.append(label("mean-probability ensembling accuracy", M.left - 50, M.top - 12, { anchor: "start", size: 13 }));

  return svg;
}

async function main() {
  const res = await fetch("./results.json");
  const results = await res.json();

  const acc1 = results.perSize[1].accuracyMean;
  const accSat = results.saturationAccuracy;
  const gain = accSat - acc1;
  const costSat = results.costPerSize[results.saturationSize];

  document.getElementById("finding").innerHTML =
    gain >= 0.02
      ? `Asking Jev the same question <span class="figure">${results.saturationSize}</span> different ways and averaging lifts accuracy from ` +
        `<span class="figure">${fmtPct(acc1)}</span> to <span class="figure">${fmtPct(accSat)}</span>, for about <span class="figure">$${costSat.toFixed(4)}</span> across ` +
        `<span class="figure">${results.items}</span> items.`
      : `Asking Jev the same question more than once barely moves accuracy here: <span class="figure">${fmtPct(acc1)}</span> at size 1 vs. ` +
        `<span class="figure">${fmtPct(accSat)}</span> at the best size tested, across <span class="figure">${results.items}</span> items.`;

  mount(document.getElementById("hero-chart"), accuracyCurve(results));
  document.getElementById("hero-caption").textContent =
    `Mean-probability ensembling accuracy at each size, averaged over ${results.trialsPerSize} resampled trials per size. ` +
    `The red dot marks where accuracy comes within 1 point of the size-100 ceiling.`;

  const meaning = document.getElementById("meaning");
  meaning.textContent =
    gain >= 0.02
      ? `Since Jev's output tokens are free, this gain is nearly free too — only the input tokens for the extra calls cost anything. If accuracy matters more than latency for your use case, asking ${results.saturationSize} times and averaging is a cheap upgrade over asking once.`
      : `The accuracy was already close to its ceiling at a single call, so ensembling mostly buys calibration and confidence stability here, not raw correctness. Worth checking your own task before assuming ensembling will move the needle.`;

  const rows = [
    ["Items", results.items],
    ["Variants per item", results.variantsPerItem],
    ["Trials per size", results.trialsPerSize],
    ["Model", results.model],
    ["Seed", results.seed],
    ["Date", new Date(results.finishedAt).toISOString().slice(0, 10)],
    ["Saturation size", results.saturationSize],
    ["Cost at saturation", `$${costSat.toFixed(4)}`],
    ["Cost at size 100", `$${results.costPerSize[100].toFixed(4)}`],
    ["Cache hits", results.cacheHits],
    ["Total measured cost", `$${results.estimatedCost.toFixed(4)}`],
  ];
  document.getElementById("method-body").innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

main().catch((err) => {
  document.getElementById("finding").textContent = `Failed to load results: ${err.message}`;
  console.error(err);
});
