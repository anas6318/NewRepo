/**
 * Behaviour preservation for place-order's validation + pricing path.
 *
 * `fixtures/order-pricing-golden.json` was captured from the BASELINE handler
 * (c532a2b) before any refactor — see fixtures/capture-order-pricing-golden.ts.
 * This test replays the CURRENT handler source over the same cases, with only
 * its I/O stubbed (fixtures/place-order-harness.ts), and requires the frozen
 * output byte-for-byte. The only permitted differences are the entries in the
 * golden file's `deviations` map, each of which names the deliberate fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES } from "./fixtures/order-pricing-cases.ts";
import { BASELINE_SHA, baselineHandlerSource, currentHandlerSource, loadHandler, runCase } from "./fixtures/place-order-harness.ts";

interface Golden {
  baselineSha: string;
  cases: { name: string; baseline: unknown }[];
  deviations: Record<string, { reason: string; expected: unknown }>;
}

const golden = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/order-pricing-golden.json", import.meta.url)), "utf8")) as Golden;

test("golden file covers exactly the defined cases, captured from the baseline", () => {
  assert.equal(golden.baselineSha, BASELINE_SHA);
  assert.deepEqual(
    golden.cases.map((c) => c.name),
    GOLDEN_CASES.map((c) => c.name),
  );
  assert.ok(golden.cases.length >= 40, "at least ~40 golden cases");
  for (const [name, d] of Object.entries(golden.deviations)) {
    assert.ok(golden.cases.some((c) => c.name === name), `deviation for unknown case ${name}`);
    assert.ok(d.reason && d.reason.length > 10, `deviation ${name} needs a reason`);
  }
});

test("the harness reproduces the frozen baseline from the baseline source", async () => {
  const handler = await loadHandler(baselineHandlerSource());
  for (const [i, gc] of GOLDEN_CASES.entries()) {
    const out = await runCase(handler, gc);
    assert.equal(JSON.stringify(out), JSON.stringify(golden.cases[i]!.baseline), `baseline replay drifted: ${gc.name}`);
  }
});

test("the current handler reproduces every golden outcome (except documented deviations)", async () => {
  const handler = await loadHandler(currentHandlerSource());
  for (const [i, gc] of GOLDEN_CASES.entries()) {
    const out = await runCase(handler, gc);
    const deviation = golden.deviations[gc.name];
    const expected = deviation ? deviation.expected : golden.cases[i]!.baseline;
    assert.equal(JSON.stringify(out), JSON.stringify(expected), `golden mismatch: ${gc.name}`);
  }
});
