# Preregistration: jev-label-bias

Locked before any label-bias run. Do not change this method after seeing results; if it must change, write a new preregistration in a later commit and keep this file.

## Hypothesis

Renaming a `choice` question's option keys, while holding the underlying criteria descriptions and the facts in `state` byte-identical, does not change which option Jev picks.

## Item construction

1,000 synthetic support-ticket routing decisions, built from a fixed template so the correct answer is known by construction, not scored against an external dataset:

- A `state` string describing one ticket, generated from a small fixed set of templates (billing / technical / sales scenarios) combined with seeded random details (amounts, product names, urgency words) so the 1,000 items are distinct but structurally uniform.
- Three routing options per ticket, described by fixed criteria text that never changes across schemes (only the option **keys** change, see below). One option is correct by construction (it's the category the template was generated from).

Generation is seeded (`42`) and deterministic; the generator lives in `run.js` and is not a separate dataset dependency.

## Label schemes (4 calls per item, identical `state` and criteria text)

For a ticket whose correct category is, say, "billing":

1. **neutral**, keys `option_a`, `option_b`, `option_c`.
2. **descriptive**, keys `billing`, `technical`, `sales` (the key names match what they mean).
3. **loaded**, keys `recommended` (assigned to the *correct* option), `unusual`, `risky` (assigned to the two incorrect options).
4. **adversarial**, keys `unlikely` (assigned to the *correct* option) and `recommended` (assigned to one *incorrect* option), third option `other`.

The `criteria` description text passed to `choice()` is identical across all 4 schemes for a given ticket, only the key names differ. This isolates the key name itself as the only variable.

Total: 1,000 × 4 = 4,000 calls.

## Recorded fields (per call)

- `id`: `${ticketId}__${scheme}`
- `scheme`: one of the four above
- `correctKeyInThisScheme`: which key is correct under this scheme's assignment
- Full `answers.route` (choice, probabilities, confidence)
- `latencyMs`, `fromCache`, `model`, `timestamp`

## Metrics (computed by `analyze.js`)

- **Accuracy per scheme**: fraction where the chosen key matches `correctKeyInThisScheme`.
- **Choice-shift rate vs. neutral**: for each ticket, fraction of schemes (descriptive, loaded, adversarial) whose choice differs from the neutral scheme's choice.
- **McNemar's test** comparing neutral-correct vs. each other scheme's correctness.
- **Adversarial case reported separately and first**: this is the headline, since it directly tests whether a misleading key name can flip a correct decision into an incorrect one.
- One concrete worked example (a specific ticket) shown in full on the page, picked as the item with the largest neutral-to-adversarial swing.

## Decision rule

- Support the hypothesis if accuracy is statistically indistinguishable (McNemar p > 0.05) across all four schemes.
- Reject if the adversarial scheme's accuracy is significantly lower than neutral's, that is the specific, actionable finding this experiment is designed to catch.

## Out of scope for this experiment

- Real-world tickets or an external dataset (the point is a controlled, isolated variable, not ecological validity).
- Calibration and bundling effects (separate experiments).
