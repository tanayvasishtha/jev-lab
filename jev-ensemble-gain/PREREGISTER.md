# Preregistration: jev-ensemble-gain

Locked before any ensemble-gain run. Do not change this method after seeing results; if it must change, write a new preregistration in a later commit and keep this file.

## Hypothesis

Since Jev's output tokens are free, asking the same question many different ways and averaging the answers improves accuracy and calibration over a single call, by a margin worth its (input-token) cost.

## Dataset and sampling

- **BoolQ**, same loader as `jev-calibration-audit`.
- `sample(all, 500, seed=42)` — 500 items. Disjoint from `jev-calibration-audit`'s run only in the sense that it's an independent seeded draw over the same pool; overlap with the full calibration sample is expected and is a free cache hit for the `variant 0` (unmodified) case only, since every other variant changes the phrasing.

## Variants (100 per item, 50,000 calls total)

Each item is asked 100 different ways, generated deterministically from a per-item seed (`42 + itemIndex`):

- **10 fixed paraphrase templates** for the instruction, written here and frozen:
  1. `Is the following statement true? {q}`
  2. `True or false: {q}`
  3. `Based on the passage, is this correct? {q}`
  4. `Does the passage support this claim? {q}`
  5. `Evaluate: {q}. Is it true?`
  6. `{q} — true or false, based on the text above?`
  7. `Fact-check this against the passage: {q}`
  8. `Is it accurate to say that {q}`
  9. `According to the passage, {q} — true?`
  10. `Verify: {q}`
- **Option order**: for the `choice` variants (see below), option key order is shuffled per call; for `noul` variants there is no order to shuffle.
- Each of the 10 templates is used as a `noul` question 5 times (5 independent calls, identical content, to measure pure sampling variance) = 50 calls, and as a `choice` question (`true`/`false` keys, order shuffled) 5 times = 50 calls. 100 calls per item total.

## Recorded fields (per call)

- `id`: `${itemId}__v${variantIndex}` (0–99)
- `templateIndex` (0–9), `questionType` (`noul` or `choice`), `optionOrder` (for choice variants)
- Full `answers`, `latencyMs`, `fromCache`, `model`, `timestamp`

## Metrics (computed by `analyze.js`)

For ensemble sizes **1, 2, 5, 10, 25, 50, 100** (subsets drawn without replacement from each item's 100 variants, 200 resamples per size for the accuracy/ECE estimate at that size):

- **Single-shot accuracy** (size 1) as the baseline.
- **Mean-probability ensembling**: average the `noul`/`true`-probability across the sampled variants, threshold at 0.5.
- **Majority vote**: threshold each variant at 0.5 first, then majority.
- **ECE** at each ensemble size (mean-probability method).
- **Saturation point**: the smallest ensemble size where accuracy is within 1 percentage point of the size-100 accuracy.
- **Cost per ensemble size**: `estimateCostUsd` scaled by the size, so the page can state the exact price of the accuracy gain.

## Decision rule

- Support the hypothesis if mean-probability ensembling at any size ≤ 25 beats single-shot accuracy by ≥ 2 percentage points.
- Report the saturation point and its cost regardless of outcome — that number is the practical takeaway either way.

## Out of scope for this experiment

- Calibration audit and bundling (separate experiments, though this reuses the same BoolQ loader and phrasing conventions where noted).
- Ensemble sizes beyond 100 or paraphrase templates beyond the 10 frozen above.
