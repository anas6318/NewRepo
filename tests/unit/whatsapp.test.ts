import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappLink } from "../../src/lib/whatsapp.ts";

test("builds wa.me link with normalized number", () => {
  const url = whatsappLink("+972 50-000-0000", "en");
  assert.ok(url.startsWith("https://wa.me/972500000000?text="));
});

test("includes product context (spec §21)", () => {
  const url = whatsappLink("972500000000", "ar", {
    intent: "order",
    productTitle: "Demo — Crimson Home",
    productUrl: "https://x.example/ar/product/crimson-2005",
    size: "L",
    version: "Player",
    personalization: { name: "AHMAD", number: "7" },
  });
  const text = decodeURIComponent(url.split("text=")[1] ?? "");
  assert.ok(text.includes("Demo — Crimson Home"));
  assert.ok(text.includes("Size: L"));
  assert.ok(text.includes("AHMAD 7"));
  assert.ok(text.includes("crimson-2005"));
});

test("uses the selected website language", () => {
  assert.ok(decodeURIComponent(whatsappLink("972500000000", "he").split("text=")[1] ?? "").includes("היי"));
  assert.ok(decodeURIComponent(whatsappLink("972500000000", "ar").split("text=")[1] ?? "").includes("مرحبًا"));
});
