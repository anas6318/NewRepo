/**
 * One-off capture: runs the BASELINE place-order handler (read with
 * `git show <BASELINE_SHA>:…`, not the working copy) over every golden case
 * and freezes the outcomes.
 *
 *   node --experimental-strip-types tests/unit/fixtures/capture-order-pricing-golden.ts
 *
 * Re-running it after the refactor reproduces the baseline file exactly; the
 * documented deviations live in the golden JSON's `deviations` map and are
 * preserved by this script.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES } from "./order-pricing-cases.ts";
import { BASELINE_SHA, baselineHandlerSource, loadHandler, runCase } from "./place-order-harness.ts";

const out = fileURLToPath(new URL("./order-pricing-golden.json", import.meta.url));
const previous = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { deviations?: Record<string, unknown> }) : {};

const handler = await loadHandler(baselineHandlerSource());
const cases: { name: string; baseline: unknown }[] = [];
for (const gc of GOLDEN_CASES) cases.push({ name: gc.name, baseline: await runCase(handler, gc) });

writeFileSync(out, `${JSON.stringify({ baselineSha: BASELINE_SHA, cases, deviations: previous.deviations ?? {} }, null, 2)}\n`, "utf8");
console.log(`captured ${cases.length} golden cases from ${BASELINE_SHA}`);
