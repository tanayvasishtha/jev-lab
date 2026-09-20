# jev-lab: build specification

Four experiments on TypeSafe's Jev, one shared harness, four standalone result pages.

This document is the contract. Build exactly what it says. Where it says "verify", verify before writing code instead of guessing.

---

## 0. Before writing any code

### 0.1 Install the TypeSafe skill
Install it, or if your agent is not supported by the installer, read the raw SKILL.md directly:
```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```
Skill source, readable directly:
`https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md`

### 0.1b Install the anti-slop design skill (required before any UI work)

The pages are the thing people will see and share. They must not look like generated UI.

```bash
npx skills add https://github.com/prathameshagrawal/design-anti-slop --skill design-anti-slop
```
If your agent is not supported by that installer, read the files directly instead, they are plain markdown:
- `https://raw.githubusercontent.com/prathameshagrawal/design-anti-slop/main/skills/design-anti-slop/SKILL.md`
- `.../patterns/visual.md`, `.../patterns/structural.md`, `.../patterns/conceptual.md`
- `.../workflows/pre-gen-brief.md`, `.../workflows/post-gen-audit.md`, `.../workflows/iterative-polish.md`

It has two modes, and **both are mandatory**:
- **Pre-generation:** run it before writing a single line of a page. It asks clarifying questions about direction. Answer them from section 5.1 of this plan.
- **Post-generation:** run it as an audit on each finished page, then fix what it flags before that page's commit.

It checks 25 patterns across three layers: visual (V1 to V9), structural (S1 to S9), conceptual (C1 to C7). For this project the ones most likely to bite are **S9 decorative data visualizations**, **S8 four-KPI card rows**, **V2 weak typography**, **V3 gradient text**, and **C1 hollow headlines**.

Second reference, read once and keep open while building pages:
`https://raw.githubusercontent.com/claudiusararu/unslop-ui-skill/main/TELLS.md` — a catalog of roughly 100 specific AI design tells with the fix for each.

### 0.2 Anti-hallucination rules (these are hard rules)

1. **Never invent an SDK method, option or response field.** The verified surface is in section 1. Anything outside it must be confirmed against the installed skill or the package's own type definitions in `node_modules/@typesafe-ai/sdk` before use.
2. **When unsure about the SDK, read the types**, do not guess: `cat node_modules/@typesafe-ai/sdk/dist/index.d.ts`.
3. **Never invent numbers.** Every number that reaches a page or a README comes from `results.json`, which comes from a real run. No placeholder statistics, no illustrative examples that look like findings, no "approximately" values written by hand.
4. **Never fabricate a dataset.** If a dataset URL 404s, stop and report it. Do not synthesize questions and present them as a public benchmark.
5. **If a run fails, report the failure.** Do not fill gaps with estimates or partial data silently. A short run honestly labeled is fine, a padded one is not.
6. **Do not change the preregistered method after seeing results.** If the method turns out to be wrong, write a new preregistration in a new commit explaining why, keep the old one.
7. **Ask before any full-size run.** Smoke runs first, always. See section 3.

### 0.3 Verified API surface

Verified by a working production call in `Slither-Me-Jev/server.js` and the official guide:

```js
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();            // reads TYPESAFE_API_KEY from env

const response = await client.systemOne({
  state: "any string or JSON describing the situation",
  questions: {
    my_key:    choice("instructions text", { option_a: "what a means", option_b: "what b means" }),
    is_urgent: noul("instructions for a yes/no probability"),
    severity:  score("instructions", ["Low", "Medium", "High"]),
  },
});

response.answers.my_key.choice          // selected key, string
response.answers.my_key.probabilities   // { option_a: 0.91, option_b: 0.09 }
response.answers.my_key.confidence      // number, choice and score only
response.answers.is_urgent.noul         // number 0..1
response.answers.severity.score         // number, can be fractional
response.model                          // e.g. "jev-1.13.0"
```

Published operational facts:
- Endpoint: `POST https://api.typesafe.ai/v1/systemone`
- Latency: 70 to 500 ms
- Rate limits: 1,200 requests/minute, 250,000 tokens/second
- Pricing: $0.042 per million input tokens, output free
- All questions in one call are answered in parallel

**To verify before relying on it:**
- Exact syntax for pinning a model version in the JS SDK. Python uses `TypeSafeClient(model="jev-1.13.0")`. Confirm the JS equivalent from the type definitions. Pinning is required, see rule 4.4.
- Whether the response exposes token usage. If it does, log it. If it does not, fall back to the estimator in section 2.4.

---

## 1. Repository layout

```
jev-lab/
  package.json              type: module, workspaces not needed, one flat package
  .env.example              TYPESAFE_API_KEY=
  .gitignore                node_modules/, .env, data/cache/, data/datasets/
  README.md                 the hub, written last, in phase 8
  PLAN.md                   this file
  DESIGN.md                 the visual identity and why each choice was made, written in phase 2

  core/
    client.js               SDK wrapper, retries, model pinning
    limiter.js              concurrency + rate limiting
    cache.js                content-addressed disk cache
    budget.js               cost estimation and hard cap
    datasets.js             BoolQ download, parse, deterministic sampling
    stats.js                ECE, Brier, bootstrap CI, McNemar
    store.js                JSONL append + resume
    runner.js               ties it together: the only thing experiments import
    smoke.js                harness self-test, runs 50 items end to end
    ui/
      lab.css               shared tokens only: colors, fonts, spacing
      chart.js              inline-SVG chart primitives (axes, line, bars, dots)

  jev-calibration-audit/
    PREREGISTER.md
    run.js
    analyze.js
    results.json
    index.html
    README.md
  jev-bundle-bias/          same six files
  jev-label-bias/           same six files
  jev-ensemble-gain/        same six files

  data/
    datasets/               gitignored, downloaded
    cache/                  gitignored, content-addressed responses
    raw/                    COMMITTED, one .jsonl per experiment
```

Only `core/runner.js` may import the SDK. No experiment file calls `client.systemOne` directly. This is what keeps caching, budgeting and rate limiting impossible to bypass.

---

## 2. The harness (`core/`)

### 2.1 `client.js`
- Exports `callJev({ state, questions })`.
- Constructs one `TypeSafeClient` at module load.
- Pins the model version (verify syntax first). Exports the resolved `MODEL_ID` so every `results.json` records it.
- Retries on 429 and 5xx: 5 attempts, exponential backoff starting at 500 ms, jittered, max 30 s.
- On non-retryable errors, throws with the request hash included so the failure is traceable.
- Records wall-clock latency per call in milliseconds.

### 2.2 `limiter.js`
- Token bucket: default 16 concurrent requests and a ceiling of 1,000 requests/minute, deliberately under the published 1,200 so a burst never trips the limit.
- Both values overridable by env (`JEV_CONCURRENCY`, `JEV_RPM`).
- On a 429 from the API, halve concurrency for 60 seconds, then recover.

### 2.3 `cache.js`
- Key: `sha256(JSON.stringify({ state, questions, model }))`.
- Value: the full response plus latency and a timestamp, written to `data/cache/<first2>/<hash>.json`.
- `callJev` checks the cache first. A cache hit costs nothing and is logged as such.
- `--no-cache` flag bypasses reads, still writes.
- **Important for the latency experiment:** cached responses carry the original latency. `analyze.js` must use latency only from calls that were actually made, and the record must carry `fromCache: true|false`.

### 2.4 `budget.js`
- `estimateCost(calls, avgInputTokens)` using $0.042 per million input tokens, output free.
- Token estimator: `Math.ceil(chars / 4)` over the serialized state and questions. Mark clearly in code that this is an estimate, and prefer real usage numbers if the API returns them.
- Every run prints, before making a single call:
  ```
  Run: jev-calibration-audit
  Items: 15,942   Calls: 15,942   Est. input tokens: 3.2M
  Est. cost: $0.14   Cache hits: 0   Budget cap: $5.00
  Proceed? (--yes to skip this prompt)
  ```
- Hard cap, default $5.00, overridable with `--cap`. The run aborts mid-flight the moment actual estimated spend crosses the cap, and what has been collected so far is kept.
- A running spend counter prints every 500 calls.

### 2.5 `datasets.js`
- BoolQ: 15,942 labeled yes/no questions with passages.
- **Verify the download URL before coding.** Try, in order: the official Google Cloud Storage location, then the HuggingFace datasets server API for `google/boolq`. If both fail, stop and report, do not substitute another dataset silently.
- Cache the download to `data/datasets/`.
- `sample(n, seed)` uses a seeded PRNG so every experiment draws the same items across reruns. Default seed: `42`, recorded in `results.json`.

### 2.6 `store.js`
- Append-only JSONL to `data/raw/<experiment>.jsonl`.
- Every record: `{ id, condition, state, questions, answer, probabilities, latencyMs, fromCache, model, timestamp }`.
- On start, read existing ids and skip them. That is what makes every run resumable.

### 2.7 `stats.js`
Implement and unit test each of these on a tiny fixture:
- `ece(predictions, labels, bins = 20)` expected calibration error.
- `brier(predictions, labels)`.
- `bootstrapCI(values, statistic, resamples = 10000, alpha = 0.05)`.
- `mcnemar(pairedA, pairedB)` for paired flip significance in the bundle and label experiments.
- `entropy(probabilities)`.

### 2.8 `smoke.js`
Runs 50 BoolQ items end to end and asserts:
1. Calls succeed and return the documented shape.
2. A second run is fully served from cache and reports $0.00.
3. Latency is recorded and is within a sane range.
4. `ece` and `brier` return finite numbers.
Phase 1 is not done until `npm run smoke` passes.

---

## 3. Token discipline (this is a hard requirement)

1. **Every experiment supports `--limit N`** and is developed at `--limit 50` until the analysis and the page are finished.
2. **Full runs happen once**, after the page renders correctly from a smoke-sized `results.json`.
3. **Ask the user before every full run.** Print the estimate from 2.4 and wait. Never launch a full run unprompted.
4. **Cache is never cleared** without asking. A cleared cache means paying twice.
5. **The pages never call Jev.** They read committed `results.json`. No API key is needed to view any result.
6. **No retry storms.** Backoff is mandatory, and a run aborts after 50 consecutive failures.
7. Every `results.json` records: `totalCalls`, `cacheHits`, `estimatedCost`, `model`, `seed`, `startedAt`, `finishedAt`.

Target total spend for all four experiments: **under $2.00**. If an estimate exceeds that, stop and report rather than proceeding.

---

## 4. The four experiments

Each one follows the same protocol: preregister, smoke, build page, ask, full run, analyze, publish.

### 4.1 `jev-calibration-audit`

**Hypothesis (preregister this):** Jev's stated confidence matches its real accuracy within an expected calibration error of 0.05.

**Method:**
- 15,942 BoolQ questions, one question per call, no bundling, so nothing contaminates the measurement.
- `state` is the BoolQ passage. The question is `noul("Is the following statement true? <question>")`. Exact wording is fixed in the preregistration and must not change after the run starts.
- Record the noul probability, the true label, latency, and entropy.

**Metrics:** ECE with 20 bins, Brier score, per-bin accuracy with counts, reliability diagram points, all headline numbers with bootstrap 95% CIs. Also latency against entropy, using only non-cached calls.

**Page (`index.html`):**
- Hero: one sentence with the actual result, for example "Jev said 90%. It was right 88.4% of the time."
- Chart 1: reliability diagram, the y=x perfect-calibration diagonal, the measured curve, the gap shaded, bin counts as a faint histogram underneath.
- Chart 2: latency against entropy, scatter with a median line. Caption the finding, whichever way it falls.
- Table: ECE, Brier, n, model version, seed, cost.

### 4.2 `jev-bundle-bias`

**Hypothesis:** bundling unrelated questions into one call does not change an individual answer.

**Method:**
- 2,000 BoolQ items.
- Condition A: the item asked alone.
- Condition B: the identical item bundled with 9 unrelated BoolQ items.
- Condition C: the identical item bundled with 9 unrelated items, in a different position within the bundle.
- 3 distinct bundle compositions per item, positions randomized with the recorded seed.
- Position is analyzed separately from bundle content, so an effect from ordering is never reported as an effect from bundling.

**Metrics:** flip rate (answer crosses 0.5) between A and B, mean absolute probability shift, McNemar's test on the paired flips, effect broken out by position.

**Page:** flip matrix (alone vs bundled), a sample of the largest probability swings as before/after arrows, and the position breakdown as a small multiples chart.

### 4.3 `jev-label-bias`

**Hypothesis:** renaming the option keys, holding criteria text and facts constant, does not change which option is chosen.

**Method:**
- 1,000 decision items. Each item is a support-ticket style routing decision built from a fixed template, with the correct answer known by construction.
- Four label schemes over identical criteria descriptions:
  - neutral: `option_a`, `option_b`, `option_c`
  - descriptive: `billing`, `technical`, `sales`
  - loaded: `recommended`, `risky`, `unusual`
  - adversarial: the correct option labeled `unlikely`, a wrong option labeled `recommended`
- Everything else byte-identical across schemes.

**Metrics:** accuracy per scheme, choice-shift rate against the neutral baseline, McNemar significance, and the adversarial scheme called out separately since it is the headline.

**Page:** slopegraph of accuracy across the four schemes, with the adversarial drop highlighted, plus one concrete worked example showing the same decision flipping on labels alone.

### 4.4 `jev-ensemble-gain`

**Hypothesis:** averaging many rephrasings of the same question beats a single call by a margin worth its cost.

**Method:**
- 500 BoolQ items × 100 variants each.
- Variants: shuffled option order and paraphrased instruction wording, drawn from a fixed list of 10 paraphrase templates written in the preregistration, combined with the seed so the set is reproducible.
- Compare: single-shot accuracy, mean-probability ensembling, majority vote, at ensemble sizes 1, 2, 5, 10, 25, 50, 100.

**Metrics:** accuracy and ECE at each ensemble size, the saturation point, and the exact measured cost of the gain.

**Page:** accuracy against ensemble size with a CI band, the saturation point marked, and a second axis or caption giving cost per ensemble size. Close with the practical recommendation the data supports.

---

## 5. Design specification for the pages

Four distinct pages. They must read as a series, and none of them may look like generated UI.

### 5.1 Direction brief (answer the anti-slop skill's pre-generation questions with this)

**What this is:** a published measurement. The closest reference points are a lab notebook, an instrument readout, and a good statistics paper's figure. FiveThirtyEight and the Our World in Data article pages are the right neighbourhood.

**What this is not:** a SaaS product page, a marketing landing page, or an analytics dashboard. There are no feature cards, no KPI tiles, no hero gradient, no call to action.

**The feeling:** someone measured something carefully and is showing you the evidence. Confident, plain, and dense with real information. The data is the decoration.

**Required reading order on every page:** the finding, then the evidence for it, then how it was measured. Anyone who reads only the first line should come away with the correct conclusion.

### 5.2 Choose the visual identity deliberately

Do not reach for the default dark developer-tool palette. Run the anti-slop skill's pre-generation mode, then pick and write down, in `DESIGN.md`:
- a type pairing chosen for this purpose, with a one-line reason (a serif or a grotesque with real character for headings, and a monospace for figures, since every important value here is a number)
- a palette built from one measured-data colour, one reference-line colour, and one attention colour, on a background chosen deliberately. Light is allowed and may be the better choice for charts.
- a spacing scale and a maximum text measure

**Banned outright** (these are the tells that make work look generated):
- purple-to-blue or any multi-stop gradient, gradient-filled text
- Inter, Geist, or the system font stack as a headline face
- glassmorphism, decorative blurred blobs, uniform 12px rounded corners on everything
- three-across icon cards, KPI tile rows, pill-shaped eyebrow labels above headings
- emoji as iconography
- drop shadows used for depth where a one-pixel rule would do
- charts that decorate rather than inform: donut charts, 3D anything, gratuitous animation on load
- centred body text, and body text below 16px

`DESIGN.md` is committed before the first page is built, and every choice in it has a stated reason. If a choice cannot be justified in one sentence, it is the wrong choice.

### 5.3 Page structure (same skeleton, different content and charts)
1. **Finding**, 32 to 40px, one sentence, containing the actual number from `results.json`.
2. **Hero chart**, the one from section 4, at least 560px tall on desktop.
3. **What this means**, two or three sentences, plain language, no hedging and no overclaiming.
4. **Method**, a compact table: n, model version, seed, date, cost, link to the raw JSONL.
5. **Secondary chart** where the experiment has one.
6. **Footer**: links to the other three experiments, so each page feeds the series.

### 5.4 Chart rules
- Inline SVG only, drawn by `core/ui/chart.js`. No charting library, no CDN scripts.
- Direct labels on the data. No legends.
- Axis labels always include units. Confidence intervals drawn as bands, never error bars alone.
- **Every chart must be readable as a 1200x675 screenshot**, which is what X renders. Build at that ratio and check it.
- Sample size printed on or beside every chart.
- Colors carry meaning and only meaning: measured data, reference line, and the thing worth noticing each get exactly one colour, as defined in `DESIGN.md`. Nothing decorative.
- The chart is the hero. If a page would still make its point with the chart deleted, the chart is not doing its job.

### 5.5 Responsiveness
- Works from 380px to 2560px, no horizontal scroll.
- Charts reflow using viewBox, they do not squash.

### 5.6 Quality bar
Before a page is called done:
- It renders correctly from a smoke-sized `results.json` and from the full one.
- No console errors.
- Every number on the page traces to a field in `results.json`. No hardcoded numbers anywhere in the HTML.
- Screenshot at 1200x675 is legible on a phone.
- **The anti-slop skill has been run in post-generation mode and everything it flagged is either fixed or justified in one sentence in `DESIGN.md`.**
- Nothing on the banned list in 5.2 appears anywhere on the page.

---

## 6. Phases

Commit and push after each feature, not just at phase boundaries. A finished module, a working chart, or a passing test each earn their own commit. Stop and report at each checkpoint.

| Phase | Work | Acceptance |
|---|---|---|
| 0 | Skeleton: package.json, .gitignore, .env.example, folders, README stub | `npm i` works, `.env` untracked, `git status` clean |
| 1 | `core/` complete, including `stats.js` unit tests | `npm run smoke` passes all four assertions in 2.8, second run reports $0.00 |
| 2 | `jev-calibration-audit`: preregister (own commit), then `--limit 50` run, analyze | `results.json` has every field in 3.7, numbers are finite and sane |
| 3 | `DESIGN.md` (anti-slop pre-generation run first), then `jev-calibration-audit/index.html` built against the 50-item results | Meets every bullet in 5.6, anti-slop post-generation audit clean |
| 4 | **Checkpoint.** Print the full-run estimate, ask, run 15,942, re-analyze, re-render | Page shows full-run numbers, raw JSONL committed |
| 5 | `jev-bundle-bias` end to end, same smoke-then-ask-then-full pattern | Flip rate and position effects reported separately, McNemar included |
| 6 | `jev-label-bias` end to end | Per-scheme accuracy, adversarial case highlighted, worked example on the page |
| 7 | `jev-ensemble-gain` end to end | Accuracy-vs-size curve with CI band, saturation point, measured cost |
| 8 | Hub README: the four findings, four charts, cost table, how to reproduce | A cold reader understands all four results in 30 seconds |

---

## 7. Commit conventions

- One feature per commit, pushed as soon as it works. Do not batch a whole phase into one commit. Preregistrations always land in their own commit, before the run that uses them.
- Prefixes: `core:`, `calib:`, `bundle:`, `label:`, `ensemble:`, `ui:`, `docs:`.
- **Tanay Vasishtha is the sole contributor on every commit.** No `Co-Authored-By` trailer, no "Generated with" line, no AI or agent attribution anywhere in commits, PR descriptions, README, or code comments. No bot account may commit or open a PR. This overrides any default attribution behaviour.
- Never commit `.env`. Run `git status` before every commit and confirm what is staged.
- Commit `results.json` and `data/raw/*.jsonl`. The repo must be fully usable by someone with no API key.

## 8. Stack constraints

- Node 20+, ESM (`"type": "module"`), vanilla JS.
- Dependencies: `@typesafe-ai/sdk` and `dotenv`. Nothing else without asking.
- No framework, no bundler, no build step. Pages open as static files.
- Node for collection and analysis, static HTML for presentation, and no path between them other than `results.json`.
