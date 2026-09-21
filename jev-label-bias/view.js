import { svgRoot, scaleLinear, axis, label, linePath, dot, mount } from "../core/ui/chart.js";

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

const SCHEME_LABELS = {
  neutral: "neutral (option_a/b/c)",
  descriptive: "descriptive (billing/technical/sales)",
  loaded: "loaded (recommended/risky/unusual)",
  adversarial: "adversarial (correct = “unlikely”)",
};
const SCHEME_ORDER = ["neutral", "descriptive", "loaded", "adversarial"];

function slopegraph(accuracyByScheme) {
  const W = 1200, H = 675;
  const M = { top: 40, right: 220, bottom: 60, left: 60 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const x = scaleLinear([0, SCHEME_ORDER.length - 1], [M.left, M.left + plotW]);
  const y = scaleLinear([0.5, 1], [M.top + plotH, M.top]);

  const svg = svgRoot(W, H, {
    label: `Slopegraph of routing accuracy across the four label schemes: ${SCHEME_ORDER.map((s) => `${s} ${fmtPct(accuracyByScheme[s])}`).join(", ")}.`,
  });
  svg.append(axis({ x1: M.left, y1: M.top + plotH, x2: M.left + plotW, y2: M.top + plotH }));
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
    svg.append(axis({ x1: M.left, y1: y(t), x2: M.left + plotW, y2: y(t), stroke: "var(--rule)", width: 1 }));
    svg.append(label(fmtPct(t), M.left - 12, y(t) + 4, { anchor: "end", mono: true, size: 12 }));
  }

  const points = SCHEME_ORDER.map((scheme, i) => ({
    x: x(i),
    y: y(accuracyByScheme[scheme]),
    scheme,
    value: accuracyByScheme[scheme],
  }));

  for (let i = 0; i < points.length - 1; i++) {
    const isAdversarialDrop = points[i + 1].scheme === "adversarial";
    svg.append(
      linePath([points[i], points[i + 1]], {
        stroke: isAdversarialDrop ? "var(--attention)" : "var(--measure)",
        width: 2.5,
      }),
    );
  }
  points.forEach((p) => {
    svg.append(dot(p.x, p.y, { r: 6, fill: p.scheme === "adversarial" ? "var(--attention)" : "var(--measure)" }));
    svg.append(label(SCHEME_LABELS[p.scheme], p.x, M.top + plotH + 28, { anchor: "middle", size: 12 }));
    svg.append(
      label(fmtPct(p.value), p.x, p.y - 14, {
        anchor: "middle",
        mono: true,
        fill: p.scheme === "adversarial" ? "var(--attention)" : "var(--ink)",
      }),
    );
  });

  svg.append(label("accuracy", M.left - 40, M.top - 10, { anchor: "start", size: 13 }));
  return svg;
}

async function main() {
  const res = await fetch("./results.json");
  const results = await res.json();

  const neutralAcc = results.accuracyByScheme.neutral;
  const adversarialAcc = results.accuracyByScheme.adversarial;
  const drop = neutralAcc - adversarialAcc;

  document.getElementById("finding").innerHTML =
    drop > 0.01
      ? `Naming the correct option <span class="figure">"unlikely"</span> drops Jev's routing accuracy from ` +
        `<span class="figure">${fmtPct(neutralAcc)}</span> to <span class="figure">${fmtPct(adversarialAcc)}</span>, across ` +
        `<span class="figure">${results.completeTickets}</span> tickets.`
      : `Renaming the options doesn't move Jev's routing accuracy: <span class="figure">${fmtPct(neutralAcc)}</span> neutral vs. ` +
        `<span class="figure">${fmtPct(adversarialAcc)}</span> with the correct option labeled "unlikely", across ` +
        `<span class="figure">${results.completeTickets}</span> tickets.`;

  mount(document.getElementById("hero-chart"), slopegraph(results.accuracyByScheme));
  document.getElementById("hero-caption").textContent =
    `Routing accuracy across the four label schemes, same ${results.completeTickets} tickets and identical criteria text in every scheme, only the option key names change.`;

  const meaning = document.getElementById("meaning");
  const ceilingCaveat =
    neutralAcc >= 0.999
      ? ` One honest caveat: neutral accuracy is already ${fmtPct(neutralAcc)}, these synthetic tickets may simply be unambiguous enough that no labeling scheme could move the answer. This result rules out a large effect on easy decisions; it doesn't rule out an effect on genuinely close calls.`
      : "";
  meaning.textContent =
    (drop > 0.01
      ? `This is a real, actionable risk: the words you choose for your enum keys can outweigh the facts you give Jev. If your key names carry any judgment ("recommended", "risky", "urgent"), that framing may be doing more work than you think.`
      : `Jev appears to be reading the criteria descriptions, not the key names, a misleading key like "unlikely" attached to the objectively correct option didn't derail it here. That's reassuring for anyone naming enum keys by convention rather than by neutral placeholder.`) +
    ceilingCaveat;

  const wx = results.workedExample;
  if (wx) {
    document.getElementById("worked-example").innerHTML = `
      <p><strong>Worked example</strong> (ticket ${wx.ticketId}):</p>
      <p><em>${wx.state}</em></p>
      <p>Neutral scheme picked <code>${wx.neutralChoice}</code> (${wx.neutralCorrect ? "correct" : "incorrect"}).
      Adversarial scheme, same facts, picked <code>${wx.adversarialChoice}</code> (${wx.adversarialCorrect ? "correct" : "incorrect"}).</p>
    `;
  }

  const rows = [
    ["Tickets", results.completeTickets],
    ["Calls (4 schemes × tickets)", results.totalCalls],
    ["Model", results.model],
    ["Seed", results.seed],
    ["Date", new Date(results.finishedAt).toISOString().slice(0, 10)],
    ["McNemar p (adversarial vs. neutral)", results.mcnemarVsNeutral.adversarial.pValue.toFixed(4)],
    ["Cache hits", results.cacheHits],
    ["Estimated cost", `$${results.estimatedCost.toFixed(4)}`],
  ];
  document.getElementById("method-body").innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
}

main().catch((err) => {
  document.getElementById("finding").textContent = `Failed to load results: ${err.message}`;
  console.error(err);
});
