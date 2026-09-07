/**
 * Product media — styled preview vs real photograph.
 *
 * The rules under test are honesty rules as much as layout rules: an image is
 * only ever named when the owner has said what it is, the photograph is never
 * duplicated as an extra gallery slide, and none of this may disturb the
 * cover image that cart lines and order snapshots already rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverImage,
  imageForView,
  orderImages,
  productMedia,
  setRoleImage,
  viewLabelKey,
  viewShortLabelKey,
} from "../../src/lib/media.ts";
import { toPublicProduct } from "../../src/services/sizing.ts";
import { demoProducts } from "../../src/services/demo/seed-data.ts";
import type { Product, ProductImage } from "../../src/services/types.ts";
import ar from "../../src/lib/i18n/ar.json" with { type: "json" };
import he from "../../src/lib/i18n/he.json" with { type: "json" };
import en from "../../src/lib/i18n/en.json" with { type: "json" };

const L = (v: string) => ({ ar: v, he: v, en: v });
const styled: ProductImage = { src: "/styled.webp", alt: L("styled"), role: "styled" };
const real: ProductImage = { src: "/real.webp", alt: L("real"), role: "real" };
const back: ProductImage = { src: "/back.webp", alt: L("back") };
const detail: ProductImage = { src: "/detail.webp", alt: L("detail") };

const bySlug = (slug: string): Product => {
  const found = demoProducts.find((p) => p.slug === slug);
  assert.ok(found, `demo product ${slug} missing`);
  return found;
};

/* ── 1. both images exposed ─────────────────────────────────────────────── */

test("a product with both images exposes each one under its own role", () => {
  const media = productMedia({ images: [styled, real, back] });
  assert.equal(media.styled?.src, "/styled.webp");
  assert.equal(media.real?.src, "/real.webp");
  assert.deepEqual(media.views, ["styled", "real"]);
  assert.equal(media.canSwitch, true);
});

/* ── 2. styled is the default view ──────────────────────────────────────── */

test("styled is the default view, and leads the view order", () => {
  assert.equal(productMedia({ images: [styled, real] }).defaultView, "styled");
  // Even when the real photograph is stored first.
  assert.equal(productMedia({ images: [real, styled] }).defaultView, "styled");
  assert.deepEqual(productMedia({ images: [real, styled] }).views, ["styled", "real"]);
});

test("imageForView resolves each view, and falls back to the cover", () => {
  const media = productMedia({ images: [styled, real] });
  assert.equal(imageForView(media, "styled")?.src, "/styled.webp");
  assert.equal(imageForView(media, "real")?.src, "/real.webp");
  assert.equal(imageForView(media, undefined)?.src, "/styled.webp");
});

/* ── 8. only styled → no dead Real toggle ───────────────────────────────── */

test("a styled-only product offers no switch but is still labelled", () => {
  const media = productMedia({ images: [styled, back] });
  assert.equal(media.canSwitch, false);
  assert.deepEqual(media.views, ["styled"]);
  assert.equal(media.real, undefined);
  assert.equal(media.defaultView, "styled");
});

/* ── 9. only real ───────────────────────────────────────────────────────── */

test("a real-only product shows its photograph as the default view", () => {
  const media = productMedia({ images: [real, detail] });
  assert.equal(media.canSwitch, false);
  assert.deepEqual(media.views, ["real"]);
  assert.equal(media.defaultView, "real");
  assert.equal(media.cover?.src, "/real.webp");
});

/* ── 10. old products still work ────────────────────────────────────────── */

test("untagged legacy images make no claim: no views, no labels, no switch", () => {
  const media = productMedia({ images: [back, detail] });
  assert.deepEqual(media.views, []);
  assert.equal(media.defaultView, undefined);
  assert.equal(media.canSwitch, false);
  assert.equal(media.cover?.src, "/back.webp");
  assert.deepEqual(media.extras, [back, detail]);
});

test("a product with no images at all keeps the placeholder path", () => {
  const media = productMedia({ images: [] });
  assert.equal(media.cover, undefined);
  assert.deepEqual(media.views, []);
  assert.equal(media.canSwitch, false);
});

test("blank image URLs are ignored rather than rendered as broken slides", () => {
  const media = productMedia({ images: [{ src: "", alt: L("x") }, back] });
  assert.equal(media.cover?.src, "/back.webp");
});

/* ── the photograph is referenced, never duplicated ─────────────────────── */

test("role images are excluded from the ordinary gallery slides", () => {
  const media = productMedia({ images: [styled, real, back, detail] });
  assert.deepEqual(media.extras, [back, detail]);
});

/* ── cover stability: cart lines and order snapshots use images[0] ──────── */

test("canonical order puts styled first so images[0] stays the cover", () => {
  const ordered = orderImages([back, real, styled, detail]);
  assert.deepEqual(ordered, [styled, real, back, detail]);
  assert.equal(coverImage({ images: ordered })?.src, ordered[0]!.src);
});

test("every demo product's cover equals images[0]", () => {
  for (const p of demoProducts) {
    assert.equal(coverImage(p)?.src, p.images[0]?.src, p.slug);
  }
});

/* ── admin edits are surgical ───────────────────────────────────────────── */

test("setting a role image replaces only that slot and keeps the gallery", () => {
  const next = setRoleImage([styled, real, back], "real", { src: "/real-2.webp", alt: L("real 2") });
  assert.deepEqual(next.map((i) => i.src), ["/styled.webp", "/real-2.webp", "/back.webp"]);
  assert.equal(next[1]!.role, "real");
});

test("clearing a role image removes it without touching the rest", () => {
  const next = setRoleImage([styled, real, back], "styled", undefined);
  assert.deepEqual(next.map((i) => i.src), ["/real.webp", "/back.webp"]);
  assert.equal(productMedia({ images: next }).canSwitch, false);
});

test("setting a role never creates a second image with that role", () => {
  const next = setRoleImage([styled, { ...styled, src: "/other.webp" }], "styled", { src: "/new.webp", alt: L("n") });
  assert.equal(next.filter((i) => i.role === "styled").length, 1);
  assert.equal(next[0]!.src, "/new.webp");
});

/* ── 12/13. the two views are never confused ────────────────────────────── */

test("the real photograph is not labelled as styled, and vice versa", () => {
  const media = productMedia({ images: [styled, real] });
  assert.equal(viewLabelKey("styled"), "media.styled");
  assert.equal(viewLabelKey("real"), "media.real");
  assert.notEqual(media.styled?.src, media.real?.src);
  assert.equal(imageForView(media, "real")?.src, real.src);
});

/* ── 14. all three languages, and no leaked enum values ─────────────────── */

test("styled/real terms exist in all three dictionaries and differ from the codes", () => {
  const dicts = [ar, he, en] as unknown as Record<string, Record<string, string>>[];
  for (const dict of dicts) {
    const media = dict.media!;
    for (const key of ["styled", "real", "styledShort", "realShort", "toggleLabel", "styledNote", "realNote"]) {
      assert.equal(typeof media[key], "string", key);
      assert.ok(media[key]!.trim().length > 0, key);
    }
    assert.notEqual(media.styled, "styled");
    assert.notEqual(media.real, "real");
  }
  const [arM, heM, enM] = dicts.map((d) => d.media!);
  assert.equal(enM!.styled, "Styled Preview");
  assert.equal(enM!.real, "Real Product");
  assert.equal(arM!.styled, "صورة تقديمية");
  assert.equal(arM!.real, "صورة المنتج الحقيقية");
  assert.equal(heM!.styled, "הדמיה מעוצבת");
  assert.equal(heM!.real, "המוצר האמיתי");
});

test("the retired Arabic wording is gone from every dictionary", () => {
  for (const dict of [ar, he, en]) {
    assert.ok(!JSON.stringify(dict).includes("عرض مُنسّق"));
  }
});

test("no deceptive claim wording is used for the styled image", () => {
  const banned = ["Official Photo", "Exact Photo", "In Stock Photo"];
  for (const dict of [ar, he, en]) {
    const json = JSON.stringify(dict);
    for (const phrase of banned) assert.ok(!json.includes(phrase), phrase);
  }
});

test("short labels exist for narrow cards and stay non-empty", () => {
  assert.equal(viewShortLabelKey("styled"), "media.styledShort");
  assert.equal(viewShortLabelKey("real"), "media.realShort");
  const dicts = [ar, he, en] as unknown as Record<string, Record<string, string>>[];
  assert.equal(dicts[2]!.media!.styledShort, "Styled");
  assert.equal(dicts[0]!.media!.realShort, "الحقيقية");
});

/* ── 17. private fields stay private ────────────────────────────────────── */

test("adding media roles does not put anything private into public products", () => {
  const source = bySlug("crimson-2005");
  const withSupplier: Product = {
    ...source,
    supplier: { sku: "SUP-1", reference: "SUP-REF-1", costUsd: 16 },
    availability: { status: "available", lastCheckedAt: "2026-08-01T00:00:00.000Z", supplierNote: "supplier said ok" },
  };
  const publicProduct = toPublicProduct(withSupplier);
  const json = JSON.stringify(publicProduct);
  assert.equal(publicProduct.supplier, undefined);
  for (const secret of ["SUP-1", "SUP-REF-1", "supplier said ok"]) assert.ok(!json.includes(secret), secret);
  // …and the media survives sanitisation intact.
  const media = productMedia(publicProduct);
  assert.equal(media.canSwitch, true);
  assert.deepEqual(Object.keys(media.styled!).sort(), ["alt", "role", "src"]);
});

/* ── demo fixtures cover every fallback branch ──────────────────────────── */

test("the demo catalog exercises both-images, styled-only, real-only and untagged", () => {
  assert.equal(productMedia(bySlug("crimson-2005")).canSwitch, true);

  const styledOnly = productMedia(bySlug("ivory-away"));
  assert.deepEqual(styledOnly.views, ["styled"]);

  const realOnly = productMedia(bySlug("scarlet-national"));
  assert.deepEqual(realOnly.views, ["real"]);

  const untagged = productMedia(bySlug("cream-hoodie"));
  assert.deepEqual(untagged.views, []);
  assert.ok(untagged.cover);
});

/* ── 23. media is not pricing ───────────────────────────────────────────── */

test("nothing in the media model can influence price", () => {
  const media = productMedia({ images: [styled, real] });
  const json = JSON.stringify(media);
  for (const word of ["price", "Ils", "sale", "discount", "badge"]) {
    assert.ok(!json.toLowerCase().includes(word.toLowerCase()), word);
  }
});
