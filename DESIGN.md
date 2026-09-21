# Visual identity

This is a published measurement, not a product. The closest references are a lab
notebook, an instrument readout, and a statistics paper's figure, FiveThirtyEight
and Our World in Data article pages are the right neighbourhood. It is not a SaaS
landing page or an analytics dashboard: no feature cards, no KPI tiles, no hero
gradient, no call to action. The chart is the hero on every page; if a page still
makes its point with the chart deleted, the chart isn't doing its job.

Reading order on every page: the finding, then the evidence, then the method.
Anyone who reads only the first line should come away with the correct conclusion.

## Type

- **Display: Source Serif 4.** A serif with real character for the one headline
  sentence on each page, so the finding reads like a claim being stated plainly,
  not a product tagline in a sans-serif default.
- **Body: Source Sans 3.** Plain, legible, gets out of the way of the numbers.
- **Numbers: IBM Plex Mono.** Every measured value is set in monospace so digits
  align in tables and don't jitter as they update.

Explicitly avoided: Inter, Geist, and the system font stack as a headline face.
These are the single most common AI-generated-design tell.

## Colour

Light paper background (`#f7f4ef`), not dark. A dark, glowing, monospace-numbers
aesthetic is itself a generated-UI default at this point (it's what Slither Me
Jev uses, deliberately, for a game). A measurement page should look like it could
be printed, so light is the deliberate choice here.

Three colours carry meaning, and only meaning:
- `--measure` (`#0b6e4f`, a muted green): what was actually measured.
- `--reference` (`#8a8a8a`, neutral grey): baselines, reference lines, perfect
  calibration, anything the measured line is being compared against.
- `--attention` (`#b00020`, a muted red): the gap, the drop, the thing the reader
  should notice. Used sparingly, only where the data itself warrants it.

No gradients anywhere, no gradient text, no glassmorphism, no drop shadows for
depth (a 1px rule is used instead), no emoji as iconography.

## Layout

- Max text measure 40rem (`--measure-max`), so body text doesn't run edge to edge.
- Spacing scale: 0.25rem, 0.5rem, 1rem, 1.5rem, 2.5rem. Nothing outside this scale.
- No centred body text. No three-across icon cards, no KPI tile rows, no pill
  eyebrow labels above headings.

## Charts

- Inline SVG only, drawn by `core/ui/chart.js`. No charting library, no CDN.
- Direct labels on the data, never a legend.
- Confidence intervals are shaded bands, never error bars alone.
- Every chart is built at 1200x675 (X's link-card ratio) and checked as a
  screenshot at that size before a page is called done.
- Sample size printed on or beside every chart.
- Charts avoided outright: donut charts, any 3D chart, decorative charts that
  don't carry a specific number, gratuitous load-in animation.

## Anti-slop check

Run against `patterns/visual.md`, `patterns/structural.md`, `patterns/conceptual.md`
(design-anti-slop skill) before each page's commit. Nothing on this project's
banned list (PLAN.md §5.2) ships. Anything the audit flags is either fixed or
justified here, in one sentence, before the commit that closes that page.
