# Preregistration: jev-bundle-bias

Locked before any bundle-bias run. Do not change this method after seeing results; if it must change, write a new preregistration in a later commit and keep this file.

## Hypothesis

Bundling a BoolQ question into one Jev call together with 9 unrelated BoolQ questions does not change its answer, compared to asking it alone. Operationally: the flip rate (answer crosses 0.5 between "alone" and "bundled") is no greater than chance noise, and the mean absolute probability shift is small (< 0.05).

## Dataset and sampling

- **BoolQ**, same loader as `jev-calibration-audit` (`core/datasets.js`).
- Target sample: `sample(all, 2000, seed=42)` — 2,000 target items.
- Filler items for bundling: drawn from the same pool, excluded from being their own filler, via a seeded RNG derived from the target's index (`seed = 42 + targetIndex`) so filler draws are deterministic and reproducible without a second global seed.

## Conditions (4 calls per target item, 8,000 calls total)

1. **alone** — one call, one question, identical phrasing to `jev-calibration-audit` so an overlapping item is a free cache hit:
   ```js
   noul(`Is the following statement true? ${question}`)
   ```
   `state`: the target's passage only.

2–4. **bundled** (3 independent compositions) — one call, 10 questions (the target plus 9 filler items freshly drawn per composition), the target inserted at a **randomly chosen position** (0–9) within that call's `questions` object, position recorded. Each filler question uses the same frozen phrasing above, keyed to its own filler id. `state`: all 10 items' passages, concatenated with a clear separator and each one labeled by its question key so Jev can tell which passage supports which question:
   ```
   [q0] <passage 0>
   [q1] <passage 1>
   ...
   ```
   The target's own key and passage are placed among these at its randomized position.

Total: 2,000 × (1 + 3) = 8,000 calls.

## Recorded fields (per call)

- `id`: `${targetId}__alone` or `${targetId}__bundle${n}`
- `condition`: `"alone"` or `"bundled"`
- `bundleIndex` (1–3) and `targetPosition` (0–9) for bundled calls
- Full `answers` map (so every filler's answer is also recoverable, though only the target's answer is analyzed here)
- `latencyMs`, `fromCache`, `model`, `timestamp`

## Metrics (computed by `analyze.js`)

- **Flip rate**: fraction of targets where `(p_alone >= 0.5) !== (p_bundled >= 0.5)`, for each of the 3 bundle compositions and pooled.
- **Mean absolute probability shift**: `mean(|p_bundled - p_alone|)`, with bootstrap 95% CI.
- **McNemar's test** on the paired (alone-correct, bundled-correct) outcomes against the gold BoolQ label, pooled across the 3 compositions.
- **Position breakdown**: flip rate and mean shift bucketed by `targetPosition` into thirds (early 0–2, mid 3–6, late 7–9), reported separately so a positional effect is never conflated with a bundling-content effect.

## Decision rule

- Support the hypothesis if pooled flip rate < 5% and mean absolute shift < 0.05.
- Reject if either threshold is exceeded, and report the position breakdown regardless of the pooled result, since a position-only effect vs. a content effect are different findings.

## Out of scope for this experiment

- Calibration and label-naming effects (separate experiments).
- Testing more than 9 filler items or more than 3 compositions per target.
