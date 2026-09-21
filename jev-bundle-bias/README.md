# Bundle bias

Part of [jev-lab](../README.md). Full interactive result: [index.html](index.html).

## Question

Jev answers every question in a call in one shared pass, that's the entire point of it. Does the presence of *other* questions in the same call change a given question's answer?

## Method

- **Dataset:** 2,000 target questions sampled from BoolQ (seed 42), each compared under two conditions.
- **Alone:** the target asked by itself, phrasing identical to the calibration audit's, so any overlapping item is a free cache hit.
- **Bundled:** the target combined with 9 unrelated questions in one call, at a randomly chosen position (0–9), repeated across 3 independently-drawn compositions per target, for 6,000 paired comparisons.
- **Metrics:** flip rate (the answer crosses 0.5 between conditions), mean absolute probability shift, McNemar's test against the gold label, and a position breakdown (early/mid/late thirds) reported separately so a positional effect is never conflated with a bundling-content effect.
- Full method, frozen before the run: [PREREGISTER.md](PREREGISTER.md).

## Result

**A real, small effect.** Flip rate 3.6% (95% CI 3.2%–4.1%), mean probability shift 0.041. Under the preregistered thresholds (< 5% flip rate, < 0.05 shift) this counts as supporting the null, but it isn't zero, about 1 in 28 bundled answers moves. The effect is flat across position and across all three compositions, so it isn't a positional artifact.

## Files

| File | Purpose |
|---|---|
| `PREREGISTER.md` | Hypothesis, method, and decision rule, committed before the run |
| `run.js` | Collects raw data into `../data/raw/jev-bundle-bias.jsonl` |
| `analyze.js` | Turns raw data into `results.json` |
| `results.json` | Committed; the page reads this, not the API |
| `index.html` / `view.js` | The result page. Note: this page also fetches the raw JSONL directly to rebuild the position scatter |

## Reproduce

```bash
node jev-bundle-bias/run.js --limit 10 --yes   # cheap dev run, ~$0.002
node jev-bundle-bias/analyze.js
node core/devserver.js                          # then open /jev-bundle-bias/
```

The full run (8,000 calls, ~$0.49) needs no `--limit`, but confirm the printed cost estimate first: `node jev-bundle-bias/run.js --yes`. Each bundled call carries 10 passages instead of 1, so its cost is roughly 10x a single-item call.

Cost: 8,000 calls, $0.49.
