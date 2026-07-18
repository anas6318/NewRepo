import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFreeDelivery, resolveDeliveryFee, freeDeliveryMessage } from "../../src/lib/delivery.ts";

test("3 qualifying items unlock free delivery (single line)", () => {
  const fd = evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 3 }], 3);
  assert.equal(fd.isFreeDeliveryUnlocked, true);
  assert.equal(fd.itemsRemaining, 0);
});

test("3 qualifying items across lines unlock (2 jerseys + 1 hoodie — spec §12 example)", () => {
  const fd = evaluateFreeDelivery(
    [
      { countsForFreeDelivery: true, quantity: 2 },
      { countsForFreeDelivery: true, quantity: 1 },
    ],
    3,
  );
  assert.equal(fd.isFreeDeliveryUnlocked, true);
});

test("quantity-based, not value-based — non-qualifying lines never count", () => {
  const fd = evaluateFreeDelivery([{ countsForFreeDelivery: false, quantity: 99 }], 3);
  assert.equal(fd.isFreeDeliveryUnlocked, false);
  assert.equal(fd.qualifyingItemCount, 0);
});

test("2 of 3 stays locked with 1 remaining", () => {
  const fd = evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 2 }], 3);
  assert.equal(fd.isFreeDeliveryUnlocked, false);
  assert.equal(fd.itemsRemaining, 1);
});

test("message keys: progressMany → progressOne → unlocked", () => {
  assert.equal(freeDeliveryMessage(evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 1 }], 3)).key, "progressMany");
  assert.equal(freeDeliveryMessage(evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 2 }], 3)).key, "progressOne");
  assert.equal(freeDeliveryMessage(evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 3 }], 3)).key, "unlocked");
});

test("fee: zone price under threshold, ₪0 once unlocked", () => {
  const locked = evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 1 }], 3);
  const unlocked = evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 3 }], 3);
  assert.equal(resolveDeliveryFee({ priceIls: 40, isActive: true }, locked), 40);
  assert.equal(resolveDeliveryFee({ priceIls: 40, isActive: true }, unlocked), 0);
});

test("fee: no matched/inactive zone throws — never a silent free ride", () => {
  const locked = evaluateFreeDelivery([{ countsForFreeDelivery: true, quantity: 1 }], 3);
  assert.throws(() => resolveDeliveryFee(null, locked));
  assert.throws(() => resolveDeliveryFee({ priceIls: 40, isActive: false }, locked));
});

test("threshold must be a positive integer", () => {
  assert.throws(() => evaluateFreeDelivery([], 0), RangeError);
});
