# Preregistration: jev-calibration-audit

Locked before any calibration run. Do not change this method after seeing results; if it must change, write a new preregistration in a later commit and keep this file.

## Hypothesis

Jev's reported confidence matches its real accuracy within an expected calibration error (ECE) of **0.05**.

Operationally: for BoolQ yes/no items, treat `noul` as P(statement is true). ECE over 20 equal-width bins on that probability vs the gold label should be ≤ 0.05 on the full planned sample.

## Dataset

- **BoolQ** (Clark et al.), train + validation/dev pooled as loaded by `core/datasets.js`.
- Full planned sample: **all** labeled items available from that loader (PLAN target n = 15,942). Development uses `--limit 50` with the same seed.
- **Seed:** `42` (harness default), recorded in `results.json`.

## Model and call shape

- Model pin: `jev-1.13.0` via `core/client.js` (`MODEL_ID`).
- One item per `systemOne` call. No bundling.
- `state`: the BoolQ **passage** string only.
- Single question key `answer`:

```js
noul(`Is the following statement true? ${question}`)
```

The instruction string above is frozen. Do not rephrase after this commit.

## Recorded fields (per item)

From the harness JSONL record plus join to BoolQ by `id`:

- `noul` probability (`answers.answer.noul`, also stored as `answer`)
- gold boolean `label`
- `latencyMs`
- binary entropy of `{p, 1-p}` where `p = noul`
- `fromCache`, `model`, `timestamp`

## Metrics (computed by `analyze.js`)

- ECE with **20** bins
- Brier score
- Per-bin accuracy and counts (reliability diagram points)
- Bootstrap 95% CIs (10,000 resamples, seed 42) for ECE, Brier, and accuracy
- Latency vs entropy using **only** rows with `fromCache === false`

## Decision rule (full sample)

- Support the hypothesis if ECE ≤ 0.05 on the full run.
- `--limit 50` runs are for pipeline and page development only; they do not decide the hypothesis.

## Out of scope for this experiment

- Bundling, label renaming, and ensembling (separate experiments).
- Changing the `noul` instruction after data collection has begun under this preregistration.
