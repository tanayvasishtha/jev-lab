/** Inline-SVG chart primitives. No library, no CDN. Built to a 1200x675 frame. */

const NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const child of children) el.append(child);
  return el;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {{ label?: string }} [extra] - `label` sets an accessible name
 *   (aria-label) for screen readers, since an inline SVG with role="img"
 *   otherwise announces nothing. Pass the same text as the chart's caption.
 */
export function svgRoot(width = 1200, height = 675, extra = {}) {
  const { label: ariaLabel, ...rest } = extra;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
    ...rest,
  });
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
  return svg;
}

/** Linear scale: maps [domainLo, domainHi] -> [rangeLo, rangeHi]. */
export function scaleLinear([domainLo, domainHi], [rangeLo, rangeHi]) {
  const span = domainHi - domainLo || 1;
  return (v) => rangeLo + ((v - domainLo) / span) * (rangeHi - rangeLo);
}

export function axis({ x1, y1, x2, y2, stroke = "var(--reference)", width = 1 }) {
  return svgEl("line", { x1, y1, x2, y2, stroke, "stroke-width": width });
}

export function label(text, x, y, opts = {}) {
  const el = svgEl("text", {
    x,
    y,
    fill: opts.fill || "var(--muted)",
    "font-family": opts.mono ? "var(--font-mono)" : "var(--font-body)",
    "font-size": opts.size || 13,
    "text-anchor": opts.anchor || "start",
    "dominant-baseline": opts.baseline || "auto",
  });
  el.textContent = text;
  return el;
}

export function linePath(points, { stroke = "var(--measure)", width = 2.5, dash = null } = {}) {
  if (!points.length) return svgEl("path", { d: "" });
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const attrs = { d, fill: "none", stroke, "stroke-width": width, "stroke-linecap": "round" };
  if (dash) attrs["stroke-dasharray"] = dash;
  return svgEl("path", attrs);
}

/** Shaded confidence band between two point arrays (same x's, lower and upper y's). */
export function band(pointsLower, pointsUpper, { fill = "var(--measure)", opacity = 0.12 } = {}) {
  if (!pointsLower.length) return svgEl("path", { d: "" });
  const top = pointsUpper.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  const bottom = pointsLower
    .slice()
    .reverse()
    .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  const d = [...top, ...bottom, "Z"].join(" ");
  return svgEl("path", { d, fill, opacity, stroke: "none" });
}

export function dot(x, y, { r = 3.5, fill = "var(--measure)", opacity = 1 } = {}) {
  return svgEl("circle", { cx: x, cy: y, r, fill, opacity });
}

export function bar(x, y, w, h, { fill = "var(--reference)", opacity = 0.35 } = {}) {
  return svgEl("rect", { x, y: y - h, width: w, height: Math.max(0, h), fill, opacity });
}

/** Render an array of SVG elements onto a target DOM node, clearing it first. */
export function mount(target, svg) {
  target.replaceChildren(svg);
}
