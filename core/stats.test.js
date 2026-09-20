import test from "node:test";
import assert from "node:assert/strict";
import { ece, brier, bootstrapCI, mcnemar, entropy } from "./stats.js";

test("ece is ~0 when bin confidence matches accuracy", () => {
  // 10 points at 0.25 all label 0; 10 points at 0.75 all label 1
  const probs = [...Array(10).fill(0.25), ...Array(10).fill(0.75)];
  const labels = [...Array(10).fill(0), ...Array(10).fill(1)];
  // Within each equal-width bin the |acc-conf| is 0.25; weighted ECE = 0.25
  // For a perfect case use probs equal to empirical rate inside bins:
  const p2 = [...Array(10).fill(0), ...Array(10).fill(1)];
  const y2 = [...Array(10).fill(0), ...Array(10).fill(1)];
  assert.ok(ece(p2, y2, 10) < 1e-12);
});

test("brier is 0 for perfect predictions", () => {
  assert.equal(brier([0, 1, 1, 0], [0, 1, 1, 0]), 0);
});

test("brier is 1 for totally wrong hard predictions", () => {
  assert.equal(brier([1, 0], [0, 1]), 1);
});

test("bootstrapCI covers the mean of a constant sample", () => {
  const [lo, hi] = bootstrapCI(
    [5, 5, 5, 5],
    (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
    { samples: 200, seed: 1 },
  );
  assert.equal(lo, 5);
  assert.equal(hi, 5);
});

test("mcnemar pValue is 1 when disagreements are empty", () => {
  const r = mcnemar([true, true], [true, true]);
  assert.equal(r.b, 0);
  assert.equal(r.c, 0);
  assert.equal(r.pValue, 1);
});

test("entropy of [0.5,0.5] is ln(2)", () => {
  assert.ok(Math.abs(entropy([0.5, 0.5]) - Math.LN2) < 1e-12);
});
