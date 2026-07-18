import { test } from "node:test";
import assert from "node:assert/strict";
import { s } from "../../src/lib/schema.ts";

const checkout = s.object({
  name: s.string().trim().min(2),
  email: s.string().trim().email(),
  phone: s.string().trim().phone(),
  notes: s.string().max(10).optional(),
});

test("valid checkout payload parses and trims", () => {
  const res = checkout.safeParse({ name: "  Anas  ", email: "a@b.co", phone: "050-123 4567", notes: "" });
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.name, "Anas");
    assert.equal(res.data.notes, undefined);
  }
});

test("invalid email + short name collect issues with paths", () => {
  const res = checkout.safeParse({ name: "A", email: "nope", phone: "0501234567" });
  assert.equal(res.success, false);
  if (!res.success) {
    const paths = res.issues.map((i) => i.path);
    assert.ok(paths.includes("name"));
    assert.ok(paths.includes("email"));
  }
});

test("phone accepts israeli formats, rejects junk", () => {
  const phone = s.object({ p: s.string().phone() });
  assert.equal(phone.safeParse({ p: "+972 50-000-0000" }).success, true);
  assert.equal(phone.safeParse({ p: "0501234567" }).success, true);
  assert.equal(phone.safeParse({ p: "abc" }).success, false);
});

test("number coercion from form strings + bounds", () => {
  const qty = s.object({ q: s.number().int().min(1).max(10) });
  const ok = qty.safeParse({ q: "3" });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.q, 3);
  assert.equal(qty.safeParse({ q: "0" }).success, false);
  assert.equal(qty.safeParse({ q: "2.5" }).success, false);
});

test("boolean .true() enforces required confirmations", () => {
  const ack = s.object({ policy: s.boolean().true() });
  assert.equal(ack.safeParse({ policy: true }).success, true);
  assert.equal(ack.safeParse({ policy: false }).success, false);
});

test("enum falls back with issue on invalid value", () => {
  const en = s.object({ method: s.enum(["card", "bank_transfer"] as const) });
  assert.equal(en.safeParse({ method: "bank_transfer" }).success, true);
  assert.equal(en.safeParse({ method: "bitcoin" }).success, false);
});
