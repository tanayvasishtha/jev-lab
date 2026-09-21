# jev-lab

Four independent experiments stress-testing [TypeSafe's Jev](https://typesafe.ai), the "System One" model that returns typed, calibrated decisions instead of text. Every number on every page traces back to a committed raw response log; nothing here is illustrative.

**[Browse the results →](index.html)**

Model tested: `jev-1.13.0`. Build spec: [PLAN.md](PLAN.md). Visual identity and reasoning: [DESIGN.md](DESIGN.md). License: [MIT](LICENSE).

## The four findings

### 1. [Calibration audit](jev-calibration-audit/), does Jev know what it doesn't know?
Ran 12,697 labeled yes/no questions (BoolQ) through Jev's `noul` type and checked its stated confidence against ground truth.

**Finding: Jev's calibration claim holds.** Expected calibration error 0.031 (95% CI 0.029–0.037), well under the 0.05 threshold we preregistered. When Jev says it's confident, it's right about as often as it claims to be.

### 2. [Bundle bias](jev-bundle-bias/), does asking questions together change the answers?
Jev answers every question in a call in one shared pass. We asked 2,000 questions alone, then bundled each one with 9 unrelated questions in 3 independent compositions (6,000 paired comparisons), and measured how often the answer moved.

**Finding: a real, small effect.** Bundling flips the answer 3.6% of the time (95% CI 3.2%–4.1%), mean probability shift 0.041. Under our preregistered thresholds this counts as supporting the null, but it's not zero, about 1 in 28 bundled answers moves. The effect is flat across position and across the three bundle compositions, so it isn't a positional artifact.

### 3. [Label bias](jev-label-bias/), does the option's name change what gets picked?
1,000 synthetic routing decisions, each asked under four label schemes with byte-identical criteria text, only the option key names changed, up to labeling the objectively correct option `"unlikely"` and a wrong one `"recommended"`.

**Finding: no measurable effect.** 100% routing accuracy across all four schemes, including the adversarial one. Jev appears to read the criteria descriptions, not the key names. Caveat on the page: these tickets were unambiguous enough that neutral accuracy was already 100%, so this rules out a large effect on easy decisions without ruling one out on genuinely close calls.

### 4. [Ensemble gain](jev-ensemble-gain/), is asking 100 times worth it?
Since Jev's output tokens are free, we asked 500 questions 100 different ways each (10 phrasings × 5 repeats × 2 question types) and compared single-shot accuracy against averaging across growing ensemble sizes, up to 100.

**Finding: no, not on this task.** Accuracy is flat at ~93.3–93.4% from a single call all the way to 100, and calibration doesn't improve either. This connects to finding #1: Jev is already well-calibrated single-shot, so there's little left for ensembling to correct.

## Cost

| Experiment | Calls | Cost |
|---|---|---|
| Calibration audit | 12,697 | $0.22 |
| Bundle bias | 8,000 | $0.49 |
| Label bias | 4,000 | $0.06 |
| Ensemble gain | 50,000 | $0.86 |
| **Total** | **74,697** | **$1.63** |

## Method

Every experiment follows the same protocol, enforced by a shared harness (`core/`):

1. **Preregister first.** Each experiment's `PREREGISTER.md` is committed *before* the run that uses it, locking the hypothesis, exact metric, and sample size in git history.
2. **Collect once, cache always.** A content-addressed disk cache means a re-run of the same request costs nothing, so analysis can be iterated on safely.
3. **Report honestly.** Confidence intervals on every headline number, raw JSONL committed alongside every result, null results reported as plainly as positive ones.
4. **No calls from the browser.** Every page reads a committed `results.json`; you can read every finding here with zero API key.
5. **Budget-capped by default.** Every collection run prints its estimated cost and asks for confirmation before spending, and a hard cap (default $5, overridable with `--cap`) aborts mid-run if crossed.

## Project layout

```
jev-lab/
  index.html              landing page linking to all four results
  PLAN.md                 the build specification this repo follows
  DESIGN.md               visual identity and the reasoning behind it
  LICENSE                 MIT

  core/                   shared harness, the only code that talks to the Jev API
    client.js             SDK wrapper, retries, model pinning
    limiter.js             concurrency + rate limiting, budget cap enforcement
    cache.js               content-addressed disk cache
    budget.js               cost estimation
    datasets.js             BoolQ loader with a GCS-then-HuggingFace fallback
    stats.js                 ECE, Brier, bootstrap CI, McNemar (unit tested)
    store.js                  JSONL append + resume, safe under concurrency
    runner.js                 ties it together, the only thing experiments import
    devserver.js               local-only static file server for previewing pages
    ui/                        shared chart primitives and page styling

  jev-calibration-audit/   } each experiment folder has the same shape:
  jev-bundle-bias/         }   PREREGISTER.md, run.js, analyze.js,
  jev-label-bias/          }   results.json, index.html, view.js, README.md
  jev-ensemble-gain/       }

  data/
    raw/                    committed JSONL logs, one per experiment
    cache/                  gitignored, local response cache
    datasets/               gitignored, downloaded BoolQ
```

## Reproduce

```bash
npm i
cp .env.example .env   # add your own TYPESAFE_API_KEY
node jev-calibration-audit/run.js --limit 50 --yes   # small, cheap dev run
node jev-calibration-audit/analyze.js
node core/devserver.js                                # open localhost:4000
```

Every experiment folder's own `README.md` has its exact reproduce commands and cost. Full runs need no `--limit`, but each one prints its cost estimate and waits for confirmation before spending anything.

Requires Node 20+. No build step, no framework: vanilla JS for both the collection scripts and the pages.
