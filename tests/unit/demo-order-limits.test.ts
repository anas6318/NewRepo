/**
 * Demo placeOrder parity with the forthcoming server (A1-B2, "Demo parity"):
 * MAX_LINE_QUANTITY / MAX_ORDER_LINES enforcement, and a size must be valid
 * for the SELECTED version (versionSizes override), not just present
 * anywhere in product.sizes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "../../src/lib/pricing.ts";
import { DemoDataService } from "../../src/services/demo/DemoDataService.ts";
import { validateOrderRequest } from "../../supabase/functions/_shared/order-pricing.ts";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** A fresh, isolated demo database for each test: a brand-new in-memory
 * localStorage means the constructor reseeds from seed-data.ts every time,
 * so no test can see another test's mutations. */
function freshService(): DemoDataService {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true });
  }
  return new DemoDataService();
}

const CUSTOMER = { name: "Order Tester", email: "order-limits@example.com", phone: "0501234567", city: "Haifa", address: "Test street 1" };

test("a quantity of 11 is rejected with invalid_quantity (client cap parity)", async () => {
  const svc = freshService();
  const res = await svc.placeOrder({
    locale: "en",
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer",
    lines: [{ productId: "demo-crimson-2005", size: "L", quantity: MAX_LINE_QUANTITY + 1 }],
  });
  assert.deepEqual(res, { ok: false, error: "invalid_quantity" });
});

test("a quantity of exactly MAX_LINE_QUANTITY is accepted", async () => {
  const svc = freshService();
  const res = await svc.placeOrder({
    locale: "en",
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer",
    lines: [{ productId: "demo-crimson-2005", size: "L", quantity: MAX_LINE_QUANTITY }],
  });
  assert.equal(res.ok, true);
});

test("a quantity of 0 or a non-integer is rejected", async () => {
  const svc = freshService();
  for (const quantity of [0, -1, 1.5]) {
    const res = await svc.placeOrder({
      locale: "en",
      customer: CUSTOMER,
      zoneId: "center",
      paymentMethod: "bank_transfer",
      lines: [{ productId: "demo-crimson-2005", size: "L", quantity }],
    });
    assert.deepEqual(res, { ok: false, error: "invalid_quantity" }, `quantity ${quantity}`);
  }
});

test("more than MAX_ORDER_LINES lines is rejected with too_many_lines, before any per-line checks", async () => {
  const svc = freshService();
  const lines = Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ productId: "does-not-exist", size: "L", quantity: 1 }));
  const res = await svc.placeOrder({ locale: "en", customer: CUSTOMER, zoneId: "center", paymentMethod: "bank_transfer", lines });
  assert.deepEqual(res, { ok: false, error: "too_many_lines" });
});

test("exactly MAX_ORDER_LINES valid lines is accepted", async () => {
  const svc = freshService();
  const lines = Array.from({ length: MAX_ORDER_LINES }, () => ({ productId: "demo-crimson-2005", size: "L", quantity: 1 }));
  const res = await svc.placeOrder({ locale: "en", customer: CUSTOMER, zoneId: "center", paymentMethod: "bank_transfer", lines });
  assert.equal(res.ok, true);
});

test("server/demo parity (V3 MUST-FIX): 0 lines -> empty_cart and 31 lines -> too_many_lines on both the core and the demo service", async () => {
  const zeroLinesBody = { locale: "en" as const, customer: CUSTOMER, zoneId: "center", paymentMethod: "bank_transfer" as const, lines: [] };
  const demoZero = await freshService().placeOrder(zeroLinesBody);
  assert.deepEqual(demoZero, { ok: false, error: "empty_cart" });
  const serverZero = validateOrderRequest(zeroLinesBody);
  assert.equal(serverZero?.error, "empty_cart");
  assert.equal(serverZero?.status, 400);

  const tooManyLinesBody = {
    locale: "en" as const,
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer" as const,
    lines: Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ productId: "does-not-exist", size: "L", quantity: 1 })),
  };
  const demoTooMany = await freshService().placeOrder(tooManyLinesBody);
  assert.deepEqual(demoTooMany, { ok: false, error: "too_many_lines" });
  const serverTooMany = validateOrderRequest(tooManyLinesBody);
  assert.equal(serverTooMany?.error, "too_many_lines");
  assert.equal(serverTooMany?.status, 400);
});

test("a size valid for one version but not the selected version is rejected (versionSizes parity)", async () => {
  const svc = freshService();
  await svc.login("admin@crowned.example", "admin1234");
  const products = await svc.adminListProducts();
  const onyx = products.find((p: { slug: string }) => p.slug === "onyx-home");
  assert.ok(onyx, "onyx-home exists in the demo catalog");
  await svc.adminSaveProduct({ ...onyx, versionSizes: { fan: ["S", "M"], player: ["L", "XL"] } });

  const mismatched = await svc.placeOrder({
    locale: "en",
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer",
    lines: [{ productId: onyx.id, version: "fan", size: "L", quantity: 1 }],
  });
  assert.deepEqual(mismatched, { ok: false, error: "invalid_size" }, "L is a player-only size once versionSizes overrides it");

  const matched = await svc.placeOrder({
    locale: "en",
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer",
    lines: [{ productId: onyx.id, version: "player", size: "L", quantity: 1 }],
  });
  assert.equal(matched.ok, true, "L is valid for the player version");
});

test("without a versionSizes override, any of the product's own sizes remain valid for any version", async () => {
  const svc = freshService();
  const res = await svc.placeOrder({
    locale: "en",
    customer: CUSTOMER,
    zoneId: "center",
    paymentMethod: "bank_transfer",
    lines: [{ productId: "demo-onyx-home", version: "fan", size: "2XL", quantity: 1 }],
  });
  assert.equal(res.ok, true);
});
