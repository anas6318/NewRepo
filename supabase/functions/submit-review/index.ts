/**
 * submit-review — validated review intake; always lands as `pending`
 * (moderation required, spec §22). Verified flag is set only when the
 * submitter's email matches a delivered order for that product.
 */
import { dbInsert, dbSelect, handleError, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = (await req.json()) as {
      productSlug?: string;
      rating?: number;
      title?: string;
      body?: string;
      displayName?: string;
      locale?: string;
      photo?: string;
    };
    if (
      !body.rating ||
      body.rating < 1 ||
      body.rating > 5 ||
      !body.title?.trim() ||
      body.title.length > 80 ||
      !body.body?.trim() ||
      body.body.length < 10 ||
      body.body.length > 1200 ||
      !body.displayName?.trim() ||
      body.displayName.length > 40 ||
      !["ar", "he", "en"].includes(body.locale ?? "")
    ) {
      return json({ ok: false, error: "invalid_review" }, 400);
    }
    if (body.photo && (!body.photo.startsWith("data:image/") || body.photo.length > 4_000_000)) {
      return json({ ok: false, error: "invalid_photo" }, 400);
    }
    if (body.productSlug) {
      const found = await dbSelect<{ slug: string }>(`products?select=slug&slug=eq.${encodeURIComponent(body.productSlug)}`);
      if (!found.length) return json({ ok: false, error: "invalid_product" }, 400);
    }

    const review = {
      id: `rv-${crypto.randomUUID()}`,
      productSlug: body.productSlug,
      rating: Math.round(body.rating),
      title: body.title.trim(),
      body: body.body.trim(),
      displayName: body.displayName.trim(),
      locale: body.locale,
      photo: body.photo,
      createdAt: new Date().toISOString(),
      status: "pending", // never auto-published
      verified: false,
      isDemo: false,
    };
    await dbInsert("reviews", { id: review.id, product_slug: review.productSlug ?? null, status: "pending", data: review, created_at: review.createdAt });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
});
