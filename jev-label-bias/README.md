# Label bias

Part of [jev-lab](../README.md). Full interactive result: [index.html](index.html).

## Question

`choice()` questions are answered by option key, `option_a`, `billing`, `recommended`, whatever name you give it. Does the key's name itself, apart from what it means, change which option Jev picks?

## Method

- **Dataset:** 1,000 synthetic support-ticket routing decisions, generated from a small fixed set of templates (billing / technical / sales) with seeded random details, so the correct answer is known by construction rather than scored against an external dataset.
- **Four label schemes**, identical criteria text in every scheme for a given ticket, only the option keys differ:
  - **neutral**: `option_a` / `option_b` / `option_c`
  - **descriptive**: `billing` / `technical` / `sales`
  - **loaded**: correct option keyed `recommended`, wrong ones `risky` / `unusual`
  - **adversarial**: correct option keyed `unlikely`, a wrong option keyed `recommended`
- 1,000 tickets × 4 schemes = 4,000 calls.
- **Metrics:** accuracy per scheme, choice-shift rate versus neutral (compared by the underlying category, not the raw key string, since every scheme uses a different key vocabulary), and McNemar's test. The adversarial scheme is the headline, since it's the one designed to actually try to fool it.
- Full method, frozen before the run: [PREREGISTER.md](PREREGISTER.md).

## Result

**No measurable effect.** 100% routing accuracy across all four schemes, including adversarial. Jev appears to read the criteria descriptions, not the key names. One honest caveat, visible on the page: neutral accuracy was already 100% on these tickets, so this rules out a large effect on easy decisions without ruling one out on genuinely close calls.

## Files

| File | Purpose |
|---|---|
| `PREREGISTER.md` | Hypothesis, method, and decision rule, committed before the run |
| `run.js` | Generates the synthetic tickets and collects raw data into `../data/raw/jev-label-bias.jsonl` |
| `analyze.js` | Turns raw data into `results.json` |
| `results.json` | Committed; the page reads this, not the API |
| `index.html` / `view.js` | The result page |

## Reproduce

```bash
node jev-label-bias/run.js --limit 30 --yes   # cheap dev run, ~$0.002
node jev-label-bias/analyze.js
node core/devserver.js                         # then open /jev-label-bias/
```

The full run (4,000 calls, ~$0.06) needs no `--limit`: `node jev-label-bias/run.js --yes`.

Cost: 4,000 calls, $0.06.
