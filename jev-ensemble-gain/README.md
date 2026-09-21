# Ensemble gain

Part of [jev-lab](../README.md). Full interactive result: [index.html](index.html).

## Question

Jev's output tokens are free, only input tokens cost anything. So does asking the same question many different ways and averaging the answers beat asking once, by a margin worth the extra input-token cost?

## Method

- **Dataset:** 500 questions sampled from BoolQ (seed 42).
- **100 variants per item:** 10 frozen paraphrase templates, each asked as a `noul` question 5 times and as a `choice` question (with shuffled option order) 5 times, 50,000 calls total.
- **Analysis:** for ensemble sizes 1, 2, 5, 10, 25, 50, and 100, 200 resampled trials per size compare mean-probability ensembling accuracy, majority-vote accuracy, and ECE against the single-shot baseline. The saturation point is the smallest size within 1 percentage point of the size-100 accuracy, with its exact cost reported.
- Full method, frozen before the run: [PREREGISTER.md](PREREGISTER.md).

## Result

**No, not on this task.** Accuracy is flat at ~93.3–93.4% from a single call all the way to 100, and calibration doesn't improve either (ECE 0.047 at size 1 versus 0.049 at size 100). This connects to the [calibration audit](../jev-calibration-audit/): Jev is already well-calibrated single-shot, so there's little left for ensembling to correct.

## Files

| File | Purpose |
|---|---|
| `PREREGISTER.md` | Hypothesis, frozen paraphrase templates, and decision rule, committed before the run |
| `run.js` | Collects raw data into `../data/raw/jev-ensemble-gain.jsonl` |
| `analyze.js` | Turns raw data into `results.json`; falls back to the committed `.jsonl.gz` if the plain file isn't present |
| `results.json` | Committed; the page reads this, not the API |
| `index.html` / `view.js` | The result page |

## Reproduce

```bash
node jev-ensemble-gain/run.js --limit 5 --yes   # cheap dev run, ~$0.01 (5 items x 100 variants)
node jev-ensemble-gain/analyze.js
node core/devserver.js                           # then open /jev-ensemble-gain/
```

The full run (50,000 calls, ~$0.86) needs no `--limit`, but confirm the printed cost estimate first: `node jev-ensemble-gain/run.js --yes`. This is the largest and slowest of the four experiments; expect roughly 45 minutes at the harness's default concurrency.

The raw data is committed gzipped (`jev-ensemble-gain.jsonl.gz`, 1.5MB versus 56MB uncompressed) since, unlike bundle-bias, no page fetches it live in the browser.

Cost: 50,000 calls, $0.86.
