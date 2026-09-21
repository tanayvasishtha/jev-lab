# Calibration audit

Part of [jev-lab](../README.md). Full interactive result: [index.html](index.html).

## Question

TypeSafe pitches Jev's `noul` type as returning a *calibrated* probability, not just a guess. Does its stated confidence actually match how often it's right?

## Method

- **Dataset:** BoolQ, all 12,697 labeled yes/no questions available from the loader (`core/datasets.js`).
- **Call shape:** one question per call, no bundling, so nothing else in the same request could influence the answer. `state` is the BoolQ passage; the question is a single frozen `noul` instruction, `Is the following statement true? {question}`.
- **Metrics:** expected calibration error (ECE, 20 bins) and Brier score, both with bootstrap 95% confidence intervals (10,000 resamples). A reliability diagram plots claimed confidence against measured accuracy per bin. Latency is also plotted against answer entropy, using only live (non-cached) calls.
- Full method, frozen before the run: [PREREGISTER.md](PREREGISTER.md).

## Result

**ECE 0.031** (95% CI 0.029–0.037), under the 0.05 threshold preregistered as the bar for "the calibration claim holds." Overall accuracy 91.6% across 12,697 items.

## Files

| File | Purpose |
|---|---|
| `PREREGISTER.md` | Hypothesis, method, and decision rule, committed before the run |
| `run.js` | Collects raw data into `../data/raw/jev-calibration-audit.jsonl` |
| `analyze.js` | Turns raw data into `results.json` |
| `results.json` | Committed; the page reads this, not the API |
| `index.html` / `view.js` | The result page |

## Reproduce

```bash
node jev-calibration-audit/run.js --limit 50 --yes   # cheap dev run, ~$0.001
node jev-calibration-audit/analyze.js
node core/devserver.js                                # then open /jev-calibration-audit/
```

The full run (12,697 calls, ~$0.22) needs no `--limit`, but confirm the printed cost estimate before running it: `node jev-calibration-audit/run.js --yes`.

Cost: 12,697 calls, $0.22.
