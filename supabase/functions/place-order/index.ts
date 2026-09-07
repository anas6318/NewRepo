/**
 * place-order — the only way an order enters the database.
 * Recomputes every price server-side from the products table (client totals
 * are never trusted), validates options, applies the quantity-based
 * free-delivery rule, generates an unguessable order number, stores a
 * contact hash for guest tracking, queues the Sheets sync, and sends the
 * confirmation email (console mode unless a provider is configured).
 */
import { audit, callerProfile, contactHash, db, dbInsert, dbSelect, handleError, json, preflight } from "../_shared/helpers.ts";
import { orderConfirmationEmail } from "../_shared/emails.ts";

interface Line {
  productId: string;
  version?: string;
  sleeve?: string;
  size: string;
  personalization?: { name?: string; number?: string };
  /** Only the id is accepted. The price is always resolved here. */
  badgeId?: string;
  /** @deprecated pre-0004 clients; treated exactly like `badgeId`. */
  patchId?: string;
  quantity: number;
}

/** Global badge catalog row. Mirrors src/lib/badges.ts — edge functions
 * cannot import from src/, so the rules are duplicated deliberately and the
 * contract is pinned by tests/unit/badges.test.ts. */
interface BadgeRow {
  id: string;
  active: boolean;
  data: { id: string; code?: string; name: unknown; priceIls: number; active?: boolean; sortOrder?: number };
  supplier_ref?: string | null;
}

interface ProductBadgeSetting {
  badgeId: string;
  enabled: boolean;
  priceOverrideIls?: number;
}

/** Sale configuration stored on the product. Mirrors src/lib/sales.ts. */
interface SaleConfig {
  enabled: boolean;
  type: "none" | "percentage" | "fixed_amount" | "fixed_price";
  percentOff?: number;
  amountOffIls?: number;
  salePriceIls?: number;
  startsAt?: string;
  endsAt?: string;
  label?: Record<string, string>;
  autoPercentLabel?: boolean;
  showBeforeStart?: boolean;
  includeAddOns?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Server-side sale resolution. Nothing about a sale is read from the request
 * body — not a price, a percentage, a discount or an "on sale" flag. The
 * schedule is evaluated against THIS server's clock in UTC, so a browser with
 * a wrong or manipulated clock cannot open or extend a sale.
 *
 * Start is inclusive, end is exclusive — identical to src/lib/sales.ts.
 */
function resolveSaleServerSide(sale: SaleConfig | undefined, discountableIls: number, nowMs: number) {
  if (!sale || !sale.enabled || sale.type === "none") return undefined;

  const start = sale.startsAt ? Date.parse(sale.startsAt) : undefined;
  const end = sale.endsAt ? Date.parse(sale.endsAt) : undefined;
  if ((sale.startsAt && Number.isNaN(start!)) || (sale.endsAt && Number.isNaN(end!))) return undefined;
  if (start !== undefined && end !== undefined && end <= start) return undefined;
  if (start !== undefined && nowMs < start) return undefined; // scheduled → regular price
  if (end !== undefined && nowMs >= end) return undefined; // expired → regular price

  let value: number;
  let discount: number;
  if (sale.type === "percentage") {
    value = sale.percentOff ?? NaN;
    if (!Number.isFinite(value) || value <= 0 || value > 100) return undefined;
    discount = round2((discountableIls * value) / 100);
  } else if (sale.type === "fixed_amount") {
    value = sale.amountOffIls ?? NaN;
    if (!Number.isFinite(value) || value <= 0 || value > discountableIls) return undefined;
    discount = round2(value);
  } else {
    value = sale.salePriceIls ?? NaN;
    if (!Number.isFinite(value) || value < 0 || value >= discountableIls) return undefined;
    discount = round2(discountableIls - value);
  }
  discount = Math.max(0, Math.min(discount, discountableIls));

  const percentOff = discountableIls > 0 ? round2((discount / discountableIls) * 100) : 0;
  const label =
    sale.label && (sale.label.en?.trim() || sale.label.ar?.trim() || sale.label.he?.trim())
      ? sale.label
      : sale.autoPercentLabel && percentOff > 0
        ? autoPercentLabel(percentOff)
        : { ar: "تخفيض", he: "מבצע", en: "Sale" };

  return { type: sale.type, value, discount, label, startsAt: sale.startsAt, endsAt: sale.endsAt };
}

/* ── cart promotion ────────────────────────────────────────────────────────
   Mirrors src/lib/promotions.ts. Nothing about a promotion is read from the
   request body — not an active flag, not a percentage, not a discounted
   item, not an amount. Everything below comes from the stored campaign and
   this server's clock. */
interface PromotionConfig {
  id: string;
  type: string;
  enabled: boolean;
  discountPercent: number;
  minimumQuantity: number;
  repeatPerPair: boolean;
  stackWithProductSales: boolean;
  startsAt?: string;
  endsAt?: string;
  label: Record<string, string>;
  eligibleProductIds?: string[];
  eligibleCategorySlugs?: string[];
  excludedProductIds?: string[];
  sortOrder: number;
}

interface PromoUnit {
  productId: string;
  slug: string;
  title: unknown;
  categorySlug?: string;
  merchandiseUnitIls: number;
  hasProductSale: boolean;
  index: number;
}

/** Same validation as the client: an unsafe campaign is treated as absent. */
function promotionIsApplicable(p: PromotionConfig, nowMs: number): boolean {
  if (!p?.enabled) return false;
  if (!Number.isFinite(p.discountPercent) || p.discountPercent <= 0 || p.discountPercent > 100) return false;
  if (!Number.isInteger(p.minimumQuantity) || p.minimumQuantity < 2) return false;
  if (!p.label?.en?.trim() || !p.label?.ar?.trim() || !p.label?.he?.trim()) return false;
  const start = p.startsAt ? Date.parse(p.startsAt) : undefined;
  const end = p.endsAt ? Date.parse(p.endsAt) : undefined;
  if (p.startsAt && Number.isNaN(start!)) return false;
  if (p.endsAt && Number.isNaN(end!)) return false;
  if (start !== undefined && end !== undefined && end <= start) return false;
  if (start !== undefined && nowMs < start) return false; // scheduled
  if (end !== undefined && nowMs >= end) return false; // expired
  return true;
}

function promotionIncludesProduct(p: PromotionConfig, productId: string, categorySlug?: string): boolean {
  if ((p.excludedProductIds ?? []).includes(productId)) return false;
  const ids = p.eligibleProductIds ?? [];
  const cats = p.eligibleCategorySlugs ?? [];
  if (ids.length === 0 && cats.length === 0) return true;
  if (ids.includes(productId)) return true;
  return !!categorySlug && cats.includes(categorySlug);
}

/** Identical ordering and grouping to src/lib/promotions.ts. */
function applyPromotion(p: PromotionConfig, units: PromoUnit[]) {
  const sorted = [...units].sort(
    (a, b) =>
      b.merchandiseUnitIls - a.merchandiseUnitIls ||
      a.productId.localeCompare(b.productId) ||
      a.slug.localeCompare(b.slug) ||
      a.index - b.index,
  );
  const groupSize = p.minimumQuantity;
  const complete = Math.floor(sorted.length / groupSize);
  const groups = p.repeatPerPair ? complete : Math.min(complete, 1);

  const items: Record<string, unknown>[] = [];
  let discount = 0;
  for (let g = 0; g < groups; g++) {
    const group = sorted.slice(g * groupSize, (g + 1) * groupSize);
    const candidates = [...group].reverse(); // cheapest first
    const chosen = p.stackWithProductSales ? candidates[0] : candidates.find((u) => !u.hasProductSale);
    if (!chosen) continue;
    const unitDiscount = round2((chosen.merchandiseUnitIls * p.discountPercent) / 100);
    if (unitDiscount <= 0) continue;
    discount = round2(discount + unitDiscount);
    items.push({
      productId: chosen.productId,
      slug: chosen.slug,
      title: chosen.title,
      unitMerchandiseIls: chosen.merchandiseUnitIls,
      discountIls: unitDiscount,
    });
  }
  const original = round2(sorted.reduce((sum, u) => sum + u.merchandiseUnitIls, 0));
  return { items, discount, original, final: round2(original - discount), eligibleUnits: sorted.length };
}

function autoPercentLabel(percent: number): Record<string, string> {
  const n = Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
  return { ar: `خصم ${n}%`, he: `${n}% הנחה`, en: `${n}% off` };
}

interface Payload {
  locale: "ar" | "he" | "en";
  customer: { name: string; email: string; phone: string; city: string; address: string; notes?: string };
  zoneId: string;
  paymentMethod: string;
  lines: Line[];
  marketingConsent?: boolean;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = (await req.json()) as Payload;

    /* basic validation */
    const c = body.customer ?? ({} as Payload["customer"]);
    if (!c.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email ?? "") || !/^\+?[0-9][0-9\s-]{6,17}$/.test(c.phone ?? "") || !c.city?.trim() || !c.address?.trim()) {
      return json({ ok: false, error: "invalid_customer" }, 400);
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 30) {
      return json({ ok: false, error: "empty_cart" }, 400);
    }

    /* settings + method + zone */
    const settingsRows = await dbSelect<{ data: Record<string, unknown> }>("store_settings?select=data&id=eq.main");
    const settings = settingsRows[0]?.data as {
      paymentMethods: { id: string; enabled: boolean; configured: boolean }[];
      freeDeliveryMinItems: number;
      bankTransferInstructions: Record<string, string>;
    };
    if (!settings) return json({ ok: false, error: "store_not_configured" }, 500);

    const method = settings.paymentMethods.find((m) => m.id === body.paymentMethod);
    if (!method?.enabled || !method.configured) return json({ ok: false, error: "payment_method_unavailable" }, 400);

    const zones = await dbSelect<{ id: string; active: boolean; data: { priceIls: number } }>(`shipping_zones?select=id,active,data&id=eq.${encodeURIComponent(body.zoneId)}`);
    const zone = zones[0];
    if (!zone?.active) return json({ ok: false, error: "zone_unavailable" }, 400);

    /* recompute pricing from the database */
    const items: Record<string, unknown>[] = [];
    let subtotal = 0;
    let qualifyingCount = 0;

    // Badge catalog, read with the service role so the internal supplier
    // reference is available for the order snapshot (it is stripped again
    // before anything customer-facing — see track-order).
    const badgeRows = await dbSelect<BadgeRow>("patches?select=id,active,data,supplier_ref");

    const pendingConfirmation: { slug: string; version?: string; size: string }[] = [];
    const promoUnits: PromoUnit[] = [];
    for (const line of body.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10) return json({ ok: false, error: "invalid_quantity" }, 400);
      const rows = await dbSelect<{ id: string; status: string; data: Record<string, unknown> }>(`products?select=id,status,data&id=eq.${encodeURIComponent(line.productId)}`);
      const product = rows[0];
      if (!product || ["draft", "archived", "unavailable"].includes(product.status)) return json({ ok: false, error: "product_unavailable" }, 400);
      const d = product.data as {
        slug: string;
        name: unknown;
        categorySlug?: string;
        images: { src: string }[];
        basePriceIls: number;
        versions: { version: string; adjustmentIls: number }[];
        sleeves: string[];
        longSleeveAdjustmentIls: number;
        sizes: string[];
        personalizable: boolean;
        patchIds?: string[];
        badges?: ProductBadgeSetting[];
        allowNoBadge?: boolean;
        sale?: SaleConfig;
        qualifiesForFreeDelivery: boolean;
        availability?: { status: string; lastCheckedAt?: string };
        versionAvailability?: Record<string, { status: string; lastCheckedAt?: string }>;
        sizeAvailability?: Record<string, { status: string; lastCheckedAt?: string }>;
      };
      if (!d.sizes.includes(line.size)) return json({ ok: false, error: "invalid_size" }, 400);

      // Supplier availability, resolved most-specific-first. A size the
      // supplier confirmed as unavailable can never be ordered; anything
      // unconfirmed holds the order before production (see below).
      const availabilityOf = (): string => {
        const k = (v: string | undefined) => `${v ?? "*"}:${line.size}`;
        // `available` only counts when a real check was recorded AND that
        // check is still within the 7-day freshness window. Stored decisions
        // are never rewritten here — a stale one simply stops confirming.
        const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
        const eff = (r?: { status: string; lastCheckedAt?: string }) => {
          if (!r) return undefined;
          if (r.status !== "available") return r.status; // decisions do not expire
          const checked = r.lastCheckedAt ? Date.parse(r.lastCheckedAt) : NaN;
          return !Number.isNaN(checked) && Date.now() - checked <= FRESH_MS ? "available" : "confirmation_required";
        };
        const chain = [
          eff(d.sizeAvailability?.[k(line.version)] ?? d.sizeAvailability?.[k(undefined)]),
          eff(line.version ? d.versionAvailability?.[line.version] : undefined),
          eff(d.availability),
        ];
        // A broader `available` never overrides a narrower restriction.
        if (chain.includes("discontinued") || product.status === "archived") return "discontinued";
        if (chain.includes("unavailable") || product.status === "unavailable") return "unavailable";
        // Publication status is not confirmation: unconfirmed by default.
        return chain.find((s) => s !== undefined) ?? "confirmation_required";
      };
      const availability = availabilityOf();
      if (availability === "unavailable" || availability === "discontinued") {
        return json({ ok: false, error: "size_unavailable" }, 400);
      }
      if (availability === "confirmation_required") {
        pendingConfirmation.push({ slug: d.slug, version: line.version, size: line.size });
      }

      let versionAdjustmentIls = 0;
      let version: string | undefined;
      if (d.versions.length > 0) {
        const v = d.versions.find((x) => x.version === line.version);
        if (!v) return json({ ok: false, error: "invalid_version" }, 400);
        version = v.version;
        versionAdjustmentIls = v.adjustmentIls;
      }
      let optionAdjustmentsIls = 0;
      let sleeve: string | undefined;
      if (d.sleeves.length > 1) {
        if (line.sleeve !== "short" && line.sleeve !== "long") return json({ ok: false, error: "invalid_sleeve" }, 400);
        sleeve = line.sleeve;
        if (sleeve === "long") optionAdjustmentsIls += d.longSleeveAdjustmentIls;
      } else if (d.sleeves[0] === "long") sleeve = "long";
      let unit = d.basePriceIls + versionAdjustmentIls + optionAdjustmentsIls;

      // ── badge / patch ───────────────────────────────────────────────────
      // The browser sends an id and nothing else. The price charged is the
      // product's own override if it has one, otherwise the global catalog
      // price. A fabricated id, a globally disabled option, an option this
      // product does not enable, or a negative price is refused outright —
      // never silently charged at ₪0.
      const selectedBadgeId = line.badgeId ?? line.patchId;
      // `badges` is authoritative; legacy `patchIds` rows upgrade in place.
      const badgeSettings: ProductBadgeSetting[] = d.badges ?? (d.patchIds ?? []).map((badgeId) => ({ badgeId, enabled: true }));
      let badgeSnapshot: Record<string, unknown> | undefined;
      let badgeAdjustmentIls = 0;
      if (selectedBadgeId) {
        const row = badgeRows.find((b) => b.id === selectedBadgeId);
        const setting = badgeSettings.find((s) => s.badgeId === selectedBadgeId);
        const globallyActive = row ? (row.data?.active ?? row.active) : false;
        if (!row || !globallyActive || !setting?.enabled) return json({ ok: false, error: "invalid_badge" }, 400);
        const override = setting.priceOverrideIls;
        const badgePrice = typeof override === "number" && Number.isFinite(override) ? override : row.data.priceIls;
        if (!Number.isFinite(badgePrice) || badgePrice < 0) return json({ ok: false, error: "invalid_badge" }, 400);
        unit += badgePrice;
        badgeAdjustmentIls = badgePrice;
        const names = (row.data.name ?? {}) as Record<string, string>;
        badgeSnapshot = {
          badgeId: row.id,
          code: row.data.code ?? row.id,
          name: row.data.name,
          label: names[body.locale] || names.en || row.id,
          priceIls: badgePrice,
          ...(row.supplier_ref ? { supplierReference: row.supplier_ref } : {}),
        };
      } else if (d.allowNoBadge === false) {
        return json({ ok: false, error: "invalid_badge" }, 400);
      }
      // ── sale ────────────────────────────────────────────────────────────
      // Resolved here from the stored configuration and this server's clock.
      // The regular price stays intact; the discount is applied on top.
      const includeAddOns = d.sale?.includeAddOns === true;
      const discountable = includeAddOns
        ? round2(d.basePriceIls + versionAdjustmentIls + optionAdjustmentsIls + badgeAdjustmentIls)
        : round2(d.basePriceIls + versionAdjustmentIls);
      const regularUnit = round2(unit);
      const activeSale = resolveSaleServerSide(d.sale, discountable, Date.now());
      const saleDiscountIls = activeSale ? Math.max(0, Math.min(activeSale.discount, discountable)) : 0;
      unit = round2(regularUnit - saleDiscountIls);

      if (line.personalization && !d.personalizable) return json({ ok: false, error: "personalization_unavailable" }, 400);
      if (line.personalization?.number && !/^\d{1,2}$/.test(line.personalization.number)) return json({ ok: false, error: "invalid_personalization" }, 400);
      if (line.personalization?.name && line.personalization.name.length > 14) return json({ ok: false, error: "invalid_personalization" }, 400);
      if (unit < 0) return json({ ok: false, error: "pricing_error" }, 500);

      const lineTotal = Math.round(unit * line.quantity * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      if (d.qualifiesForFreeDelivery) qualifyingCount += line.quantity;

      items.push({
        productId: product.id,
        slug: d.slug,
        title: d.name,
        image: d.images[0]?.src ?? "",
        version,
        sleeve,
        size: line.size,
        personalization: line.personalization,
        // Immutable: later catalog edits never reach back into this order.
        ...(badgeSnapshot ? { badge: badgeSnapshot, patchId: badgeSnapshot.badgeId, patchName: badgeSnapshot.name } : {}),
        // Immutable price breakdown. Editing or ending the sale afterwards
        // cannot reach back into a placed order.
        price: {
          regularBasePriceIls: d.basePriceIls,
          versionAdjustmentIls,
          optionAdjustmentsIls,
          badgeAdjustmentIls,
          regularUnitPriceIls: regularUnit,
          ...(saleDiscountIls > 0 && activeSale ? { saleType: activeSale.type, saleValue: activeSale.value } : {}),
          saleDiscountIls,
          finalUnitPriceIls: unit,
          ...(saleDiscountIls > 0 && activeSale ? { saleLabel: activeSale.label[body.locale] || activeSale.label.en } : {}),
          ...(saleDiscountIls > 0 && activeSale?.startsAt ? { saleStartsAt: activeSale.startsAt } : {}),
          ...(saleDiscountIls > 0 && activeSale?.endsAt ? { saleEndsAt: activeSale.endsAt } : {}),
          // For a request held pending supplier confirmation, the sale price
          // is only guaranteed for as long as the sale itself runs.
          ...(saleDiscountIls > 0 && activeSale?.endsAt && availability === "confirmation_required" ? { priceValidUntil: activeSale.endsAt } : {}),
        },
        unitPriceIls: unit,
        quantity: line.quantity,
        lineTotalIls: lineTotal,
      });

      // One promotion unit per ordered unit — quantity 2 counts as two.
      for (let u = 0; u < line.quantity; u++) {
        promoUnits.push({
          productId: product.id,
          slug: d.slug,
          title: d.name,
          ...(d.categorySlug ? { categorySlug: d.categorySlug } : {}),
          // Merchandise only: the badge charge is subtracted, and any
          // product sale is already reflected in `unit`.
          merchandiseUnitIls: round2(unit - badgeAdjustmentIls),
          hasProductSale: saleDiscountIls > 0,
          index: u,
        });
      }
    }

    /* ── cart promotion, recomputed from the database ── */
    const promoRows = await dbSelect<{ id: string; data: PromotionConfig }>("promotions?select=id,data,sort_order&order=sort_order");
    const nowMs = Date.now();
    const campaign = promoRows.map((r) => r.data).find((p) => promotionIsApplicable(p, nowMs));
    let promotion: Record<string, unknown> | undefined;
    let promotionDiscountIls = 0;
    if (campaign) {
      const eligible = promoUnits.filter((u) => promotionIncludesProduct(campaign, u.productId, u.categorySlug));
      const applied = applyPromotion(campaign, eligible);
      if (applied.discount > 0) {
        promotionDiscountIls = applied.discount;
        promotion = {
          promotionId: campaign.id,
          type: campaign.type,
          label: campaign.label,
          labelText: campaign.label[body.locale] || campaign.label.en,
          discountPercent: campaign.discountPercent,
          minimumQuantity: campaign.minimumQuantity,
          repeatPerPair: campaign.repeatPerPair,
          stackWithProductSales: campaign.stackWithProductSales,
          ...(campaign.startsAt ? { startsAt: campaign.startsAt } : {}),
          ...(campaign.endsAt ? { endsAt: campaign.endsAt } : {}),
          eligibleUnits: applied.eligibleUnits,
          discountedUnits: applied.items.length,
          originalMerchandiseIls: applied.original,
          discountIls: applied.discount,
          finalMerchandiseIls: applied.final,
          items: applied.items,
        };
      }
    }

    /* delivery: quantity-based free delivery (spec §12) */
    const minItems = settings.freeDeliveryMinItems ?? 3;
    const freeDelivery = qualifyingCount >= minItems;
    const deliveryIls = freeDelivery ? 0 : zone.data.priceIls;
    // The promotion reduces merchandise only; delivery is never discounted.
    const merchandiseAfterPromotion = round2(subtotal - promotionDiscountIls);
    const total = round2(merchandiseAfterPromotion + deliveryIls);

    /* order number via DB function (unique, unguessable) */
    const numRes = await db("rpc/generate_order_number", { method: "POST", body: "{}" });
    if (!numRes.ok) return json({ ok: false, error: "order_number_failed" }, 500);
    const needsSupplierCheck = pendingConfirmation.length > 0;
    const orderNumber = (await numRes.json()) as string;

    const caller = await callerProfile(req);
    const isBank = body.paymentMethod === "bank_transfer";
    const now = new Date().toISOString();
    const hash = await contactHash(c.email);

    const orderData = {
      id: crypto.randomUUID(),
      orderNumber,
      createdAt: now,
      locale: body.locale,
      customer: { ...c, customerId: caller?.id },
      items,
      subtotalIls: subtotal,
      // A separate, visible line — never folded into the subtotal.
      ...(promotion ? { promotion, promotionDiscountIls } : {}),
      deliveryIls,
      freeDelivery,
      totalIls: total,
      zoneId: zone.id,
      paymentMethod: body.paymentMethod,
      paymentStatus: isBank ? "awaiting_payment" : "pending",
      // Unconfirmed supplier availability holds the order: nothing is
      // reserved, ordered from the supplier or produced in this state.
      fulfillmentStatus: needsSupplierCheck ? "awaiting_supplier_confirmation" : isBank ? "awaiting_payment" : "order_received",
      tracking: [
        { status: "order_received", at: now },
        ...(needsSupplierCheck ? [{ status: "awaiting_supplier_confirmation", at: now }] : isBank ? [{ status: "awaiting_payment", at: now }] : []),
      ],
      ...(needsSupplierCheck ? { supplierConfirmation: { required: true, status: "pending", items: pendingConfirmation } } : {}),
      sheetsSync: { status: "pending" },
      isDemo: false,
    };

    await dbInsert("orders", {
      id: orderData.id,
      order_number: orderNumber,
      customer_id: caller?.id ?? null,
      contact_hash: hash,
      payment_status: orderData.paymentStatus,
      fulfillment_status: orderData.fulfillmentStatus,
      total_ils: total,
      locale: body.locale,
      data: orderData,
      created_at: now,
    });

    await dbInsert("sheets_sync_log", { order_number: orderNumber, status: "pending" });
    if (body.marketingConsent) {
      await dbInsert("leads", { kind: "email", value: c.email, consent: true, consent_source: "checkout" });
    }
    await audit("storefront", "order_created", orderNumber, `total=${total}`);

    /* confirmation email — best effort, never blocks the order */
    try {
      const email = orderConfirmationEmail(body.locale, {
        orderNumber,
        totalIls: total,
        bankInstructions: isBank ? settings.bankTransferInstructions?.[body.locale] : undefined,
      });
      await sendEmailSafe(c.email, email.subject, email.html);
    } catch (e) {
      console.error("[place-order] email failed:", e);
    }

    /* fire-and-forget sheets sync attempt */
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sheets-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify({ orderNumber }),
      });
    } catch {
      /* retried by cron — see docs/google-sheets-setup.md */
    }

    return json({ ok: true, orderNumber, trackingContact: c.email, order: orderData });
  } catch (err) {
    return handleError(err);
  }
});

async function sendEmailSafe(to: string, subject: string, html: string): Promise<void> {
  const { sendEmail } = await import("../_shared/helpers.ts");
  await sendEmail(to, subject, html);
}
