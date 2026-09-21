# jev-lab

Four independent experiments stress-testing [TypeSafe's Jev](https://typesafe.ai), the "System One" model that returns typed, calibrated decisions instead of text. Every number on every page traces back to a committed raw response log; nothing here is illustrative.

Model tested: `jev-1.13.0`. Full build spec: [PLAN.md](PLAN.md). Visual identity and reasoning: [DESIGN.md](DESIGN.md).

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

## Reproduce

```bash
npm i
cp .env.example .env   # add your own TYPESAFE_API_KEY
node jev-calibration-audit/run.js --limit 50 --yes   # small, cheap dev run
node jev-calibration-audit/analyze.js
```

Open any `index.html` directly, or serve the folder locally (`node core/devserver.js`).
