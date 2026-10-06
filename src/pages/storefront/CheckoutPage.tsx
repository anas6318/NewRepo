/** Checkout (spec §14/§15): guest + account, zone-based delivery, honest
 * payment methods (only enabled+configured methods appear), full order
 * summary with no hidden fees. Totals recompute server-side on placement. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { localizeIssues } from "../../lib/form-errors.ts";
import { cartNeedsSupplierConfirmation } from "../../lib/orders.ts";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { useCart, useSession, useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { s } from "../../lib/schema.ts";
import { resolveDeliveryFee } from "../../lib/delivery.ts";
import { sizeOptionsFor } from "../../services/sizing.ts";
import type { CartLine, PaymentMethodId, Product } from "../../services/types.ts";
import { Field } from "../../components/product/ReviewsSection.tsx";
import { FreeDeliveryProgress } from "../../components/product/FreeDeliveryProgress.tsx";
import { EmptyState, Price, useL } from "../../components/ui/bits.tsx";
import { IconBag } from "../../components/ui/Icons.tsx";
import { formatBadgeAdjustment } from "../../lib/badges.ts";
import { PromotionLine } from "../../components/cart/PromotionSummary.tsx";
import { SafeImage } from "../../components/ui/SafeImage.tsx";
import type { PlaceOrderInput } from "../../services/DataService.ts";
import { IDEMPOTENCY_KEY_PATTERN, quickFingerprint, requestHashInput } from "../../../supabase/functions/_shared/order-idempotency.ts";

/**
 * Checkout idempotency (A2-S3). One key per checkout ATTEMPT, stored in
 * sessionStorage beside a fingerprint of exactly what the server hashes
 * (the same canonical form — order-idempotency.ts), so:
 *   - a retry / double submit of the same cart + form reuses the key and
 *     can never create a second order (the server replays the first one);
 *   - any change to the cart or form starts a fresh key, so an edited
 *     attempt is never mistaken for the old one (no spurious 409);
 *   - a successful order, or a 409 conflict, clears it.
 */
export const CHECKOUT_IDEMPOTENCY_STORAGE_KEY = "crowned_checkout_idem_v1";

function newIdempotencyKey(): string | undefined {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues !== "function") return undefined; // legacy path
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The key for this attempt: the stored one when the attempt is unchanged,
 * otherwise a fresh one (persisted before the request is sent). */
export function checkoutIdempotencyKey(input: Omit<PlaceOrderInput, "idempotencyKey">): string | undefined {
  const fp = quickFingerprint(requestHashInput(input));
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) ?? "null") as { key?: unknown; fp?: unknown } | null;
    if (stored && stored.fp === fp && typeof stored.key === "string" && IDEMPOTENCY_KEY_PATTERN.test(stored.key)) return stored.key;
  } catch {
    /* unreadable → start a fresh attempt */
  }
  const key = newIdempotencyKey();
  try {
    if (key) sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY, JSON.stringify({ key, fp }));
  } catch {
    /* storage unavailable: the key still protects this request */
  }
  return key;
}

export function clearCheckoutIdempotencyKey(): void {
  try {
    sessionStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * A cart line is "stale" (A1-B6) when the product behind it has been
 * removed from the catalog, is no longer published/available, or no longer
 * offers the line's version/size. This is a catalog-validity question,
 * distinct from `needsSupplierCheck` (which is about supplier confirmation,
 * not whether the configuration can still be ordered at all). Reuses the
 * product list Checkout already fetches for `needsSupplierCheck`.
 */
export function staleCartLineReason(
  line: Pick<CartLine, "productId" | "slug" | "version" | "size">,
  products: readonly Product[],
): "removed" | "unavailable" | "size" | null {
  const product = products.find((p) => p.id === line.productId || p.slug === line.slug);
  if (!product) return "removed";
  if (product.status === "draft" || product.status === "archived" || product.status === "unavailable") return "unavailable";
  if (product.versions.length > 0 && line.version && !product.versions.some((v) => v.version === line.version)) {
    return "unavailable";
  }
  const options = sizeOptionsFor(product, line.version);
  if (!options.some((o) => o.size === line.size)) return "size";
  return null;
}

const checkoutSchema = s.object({
  name: s.string().trim().min(2).max(60),
  email: s.string().trim().email(),
  phone: s.string().trim().phone(),
  city: s.string().trim().min(2).max(40),
  address: s.string().trim().min(4).max(160),
  notes: s.string().max(500).optional(),
});

export function CheckoutPage() {
  const { locale, t, has } = useI18n();
  const L = useL();
  const navigate = useNavigate();
  const cart = useCart();
  const { customer } = useSession();
  const { settings, zones } = useSettings();

  usePageMeta({ title: t("checkout.title"), path: "/checkout", locale, noindex: true });

  const [fields, setFields] = useState({
    name: customer?.name ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    city: "",
    address: "",
    notes: "",
  });
  const [zoneId, setZoneId] = useState("");
  const [method, setMethod] = useState<PaymentMethodId | "">("");
  const [policyAck, setPolicyAck] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // A1-B5: a ref, not just the `busy` state, so a double-click or
  // double-Enter cannot re-enter submit() before React has committed the
  // re-render that disables the button — state updates are not guaranteed
  // to have landed synchronously between two rapid native events.
  const submittingRef = useRef(false);
  const [products, setProducts] = useState<Product[]>([]);

  /**
   * Does this cart have to wait for a supplier check? Resolved from the
   * products' own availability records — the same rule place-order applies
   * server-side — so Checkout and the order agree.
   *
   * Starts as `true`: until the products are loaded we do not yet know, and
   * withholding bank details is the safe direction to be wrong in.
   */
  const [needsSupplierCheck, setNeedsSupplierCheck] = useState(true);
  const cartSignature = cart.lines.map((l) => `${l.slug}|${l.version ?? ""}|${l.size}`).join(",");

  useEffect(() => {
    let alive = true;
    if (cart.lines.length === 0) {
      setNeedsSupplierCheck(false);
      return;
    }
    dataService()
      .listProducts()
      .then((list) => {
        if (!alive) return;
        setNeedsSupplierCheck(cartNeedsSupplierConfirmation(cart.lines, list));
        // A1-B6: the same fetch that decides needsSupplierCheck also backs
        // the stale-line flags below — no extra request.
        setProducts(list);
      })
      .catch(() => {
        // Could not check — keep the details hidden rather than guess.
        if (alive) setNeedsSupplierCheck(true);
      });
    return () => {
      alive = false;
    };
    // cartSignature covers exactly the fields availability depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature]);

  // A1-B6: lines whose product was removed/unpublished/unavailable, or
  // whose version/size is no longer offered. Flagged inline and blocks
  // submission until the customer removes them.
  const staleLineKeys = useMemo(() => {
    if (products.length === 0) return new Set<string>();
    const keys = new Set<string>();
    for (const line of cart.lines) {
      if (staleCartLineReason(line, products)) keys.add(line.key);
    }
    return keys;
  }, [cart.lines, products]);

  const availableMethods = useMemo(
    () => (settings?.paymentMethods ?? []).filter((m) => m.enabled && (m.configured || isDemoMode())),
    [settings],
  );
  const zone = zones.find((z) => z.id === zoneId);
  const deliveryIls = useMemo(() => {
    if (!zone) return null;
    try {
      return resolveDeliveryFee({ priceIls: zone.priceIls, isActive: zone.active }, cart.freeDelivery);
    } catch {
      return null;
    }
  }, [zone, cart.freeDelivery]);

  if (cart.lines.length === 0) {
    return (
      <main id="main" className="container section">
        <h1 className="sr-only">{t("checkout.title")}</h1>
        <EmptyState
          icon={<IconBag size={22} />}
          title={t("cart.empty")}
          action={
            <Link to={`/${locale}/shop`} className="btn btn--gold">
              {t("cart.continueShopping")}
            </Link>
          }
        />
      </main>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A1-B5 re-entrancy guard: checked first, before any state read/write,
    // so a second synchronous invocation from a double-click/double-Enter
    // can never fall through.
    if (submittingRef.current || busy) return;
    setServerError(null);
    const parsed = checkoutSchema.safeParse(fields);
    const map: Record<string, string> = {};
    if (!parsed.success) Object.assign(map, localizeIssues(parsed.issues, t));
    if (!zoneId) map.zone = t("checkout.selectZone");
    if (!method) map.method = t("checkout.selectPayment");
    if (!policyAck) map.policyAck = t("checkout.policyAckRequired");
    // A1-B6: stale lines (removed/unpublished/unavailable product, or a
    // size/version no longer offered) block submission until removed.
    if (staleLineKeys.size > 0) map.stale = t("checkout.staleLineBlocksSubmit");
    setErrors(map);
    if (Object.keys(map).length > 0 || !parsed.success) {
      document.getElementById("checkout-errors")?.focus();
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    track("add_shipping_info", { zone: zoneId });
    track("add_payment_info", { method });
    const orderInput: Omit<PlaceOrderInput, "idempotencyKey"> = {
      locale,
      customer: parsed.data,
      zoneId,
      paymentMethod: method as PaymentMethodId,
      lines: cart.lines.map((l) => ({
        productId: l.productId,
        version: l.version,
        sleeve: l.sleeve,
        size: l.size,
        personalization: l.personalization,
        // Only the badge id is sent. The server resolves the price itself.
        badgeId: l.badge?.badgeId ?? l.patchId,
        quantity: l.quantity,
      })),
      marketingConsent: consent,
    };
    // Same attempt → same key (retries, double submits); changed → new key.
    const idempotencyKey = checkoutIdempotencyKey(orderInput);
    let res: Awaited<ReturnType<ReturnType<typeof dataService>["placeOrder"]>>;
    try {
      res = await dataService().placeOrder({ ...orderInput, ...(idempotencyKey ? { idempotencyKey } : {}) });
    } catch {
      // A thrown network/transport error must read as a failed order, never
      // as a silent no-op. The form keeps everything the customer typed —
      // the same promise every other submitting form makes on a thrown
      // error (ui-integrity parity).
      submittingRef.current = false;
      setBusy(false);
      setServerError(t("errors.submitFailedKeep"));
      document.getElementById("checkout-errors")?.focus();
      return;
    }
    submittingRef.current = false;
    setBusy(false);

    if (!res.ok) {
      // The key belongs to a different request on the server (e.g. the
      // cart changed in another tab mid-attempt): drop it so the next
      // submit is a fresh attempt, and ask the customer to review.
      if (res.error === "idempotency_conflict") clearCheckoutIdempotencyKey();
      // A backend code this build has no wording for must degrade to the
      // generic message. `t()` echoes an unknown key back as a string, so a
      // `||` fallback never fires — the key has to be checked first.
      const key = `checkout.error_${res.error ?? "generic"}`;
      setServerError(has(key) ? t(key) : t("checkout.error_generic"));
      return;
    }
    if (!res.orderNumber) {
      // Defensive: an ok:true response should always carry an order number.
      setServerError(t("checkout.error_generic"));
      return;
    }
    // `res.duplicate` (the server replayed the order this attempt already
    // created) is success exactly like a fresh order: same confirmation.
    clearCheckoutIdempotencyKey();
    track("purchase", { value: res.order?.totalIls ?? cart.subtotalIls, order: res.orderNumber, method });
    cart.clear();
    try {
      sessionStorage.setItem("crowned_last_order", JSON.stringify({ n: res.orderNumber, c: res.trackingContact ?? "" }));
    } catch {
      /* ignore */
    }
    navigate(`/${locale}/order/confirmation/${res.orderNumber}`);
  };

  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  const errorList = Object.entries(errors);

  return (
    <main id="main" className="container section--tight section">
      <h1 className="section__title mb-6">{t("checkout.title")}</h1>

      {!customer && (
        <p className="text-sm text-muted mb-6">
          {t("checkout.guestCheckout")} ·{" "}
          <Link to={`/${locale}/login`} className="text-gold">
            {t("checkout.loginPrompt")}
          </Link>
        </p>
      )}

      {errorList.length > 0 && (
        <div className="error-summary mb-6" id="checkout-errors" tabIndex={-1} role="alert">
          <strong>{t("checkout.fixErrors")}</strong>
          <ul>
            {errorList.map(([k, v]) => (
              <li key={k}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {serverError && (
        <div className="error-summary mb-6" role="alert">
          {serverError}
        </div>
      )}

      <form className="cart-layout" onSubmit={submit} noValidate>
        <div className="stack stack--lg">
          <section className="card stack" aria-labelledby="contact-h">
            <h2 id="contact-h" className="drawer__title">
              {t("checkout.contactTitle")}
            </h2>
            <div className="form-grid">
              <Field id="co-name" label={t("checkout.fullName")} error={errors.name} required>
                <input id="co-name" className="input" autoComplete="name" value={fields.name} aria-invalid={!!errors.name} onChange={set("name")} />
              </Field>
              <Field id="co-email" label={t("checkout.email")} error={errors.email} required>
                <input id="co-email" type="email" className="input" autoComplete="email" dir="ltr" value={fields.email} aria-invalid={!!errors.email} onChange={set("email")} />
              </Field>
              <Field id="co-phone" label={t("checkout.phone")} error={errors.phone} required>
                <input id="co-phone" type="tel" className="input" autoComplete="tel" dir="ltr" value={fields.phone} aria-invalid={!!errors.phone} onChange={set("phone")} />
              </Field>
            </div>
          </section>

          <section className="card stack" aria-labelledby="ship-h">
            <h2 id="ship-h" className="drawer__title">
              {t("checkout.shippingTitle")}
            </h2>
            <div className="form-grid">
              <Field id="co-zone" label={t("checkout.zone")} error={errors.zone} required>
                <select id="co-zone" className="select" value={zoneId} aria-invalid={!!errors.zone} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">{t("common.select")}</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {L(z.name)} — ₪{z.priceIls} ({z.etaDays} {t("checkout.days")})
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="co-city" label={t("checkout.city")} error={errors.city} required>
                <input id="co-city" className="input" autoComplete="address-level2" value={fields.city} aria-invalid={!!errors.city} onChange={set("city")} />
              </Field>
              <Field id="co-address" label={t("checkout.address")} error={errors.address} required>
                <input id="co-address" className="input" autoComplete="street-address" value={fields.address} aria-invalid={!!errors.address} onChange={set("address")} />
              </Field>
              <Field id="co-notes" label={`${t("checkout.notes")} (${t("common.optional")})`}>
                <textarea id="co-notes" className="textarea" style={{ minHeight: 60 }} value={fields.notes} onChange={set("notes")} />
              </Field>
            </div>
            {settings && <p className="text-xs text-muted">{L(settings.supplierEtaText)}</p>}
          </section>

          <section className="card stack" aria-labelledby="pay-h">
            <h2 id="pay-h" className="drawer__title">
              {t("checkout.paymentTitle")}
            </h2>
            {errors.method && (
              <p className="field__error" role="alert">
                {errors.method}
              </p>
            )}
            <div className="stack stack--sm" role="radiogroup" aria-labelledby="pay-h">
              {availableMethods.map((m) => (
                <label key={m.id} className={`pay-option${method === m.id ? " is-selected" : ""}`}>
                  <input type="radio" name="payment" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
                  <span className="pay-option__label">{L(m.label)}</span>
                  {m.id === "bank_transfer" && <span className="badge badge--muted">{t("checkout.manualVerification")}</span>}
                  {isDemoMode() && m.id !== "bank_transfer" && <span className="badge badge--demo">{t("checkout.simulatedDemo")}</span>}
                </label>
              ))}
              {availableMethods.length === 0 && <p className="text-muted text-sm">{t("checkout.noMethods")}</p>}
            </div>
            {/* Bank transfer stays SELECTABLE either way — this only governs
                whether the account details themselves are printed. CROWNED's
                flow confirms availability before asking anyone to transfer
                money, and the Confirmation page already withheld them; doing
                it here too is what makes the two consistent. */}
            {method === "bank_transfer" && settings && !needsSupplierCheck && (
              <div className="card stack--sm stack" data-testid="bank-details" style={{ background: "var(--paper)", padding: "var(--sp-4)" }}>
                <strong className="text-sm">{t("checkout.bankTransferInfoTitle")}</strong>
                <p className="text-sm text-muted" style={{ whiteSpace: "pre-line" }}>
                  {L(settings.bankTransferInstructions)}
                </p>
              </div>
            )}
            {method === "bank_transfer" && needsSupplierCheck && (
              <div className="card stack--sm stack" data-testid="bank-held" style={{ borderColor: "var(--warn)", padding: "var(--sp-4)" }}>
                <strong className="text-sm">{t("checkout.bankTransferAfterConfirmation")}</strong>
                <p className="text-sm text-muted">{t("checkout.bankTransferHeldBody")}</p>
              </div>
            )}
            {isDemoMode() && (
              <p className="text-xs" style={{ color: "var(--warn)" }}>
                {t("checkout.demoPaymentNote")}
              </p>
            )}
          </section>

          <section className="card stack stack--sm" aria-label={t("checkout.confirmations")}>
            <label className="check">
              <input type="checkbox" checked={policyAck} onChange={(e) => setPolicyAck(e.target.checked)} />
              <span>
                {t("checkout.policyAck")}{" "}
                <Link to={`/${locale}/policies/returns`} className="text-gold" target="_blank">
                  {t("product.policyLinkText")}
                </Link>
              </span>
            </label>
            {errors.policyAck && (
              <p className="field__error" role="alert">
                {errors.policyAck}
              </p>
            )}
            <label className="check">
              {/* Marketing consent — never preselected (spec §23) */}
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-sm text-muted">{t("checkout.marketingConsent")}</span>
            </label>
          </section>
        </div>

        <aside className="card stack checkout-summary" aria-label={t("checkout.orderSummary")}>
          <h2 className="drawer__title">{t("checkout.orderSummary")}</h2>
          <ul className="stack stack--sm" style={{ listStyle: "none", padding: 0 }}>
            {cart.lines.map((line) => (
              <li key={line.key} className="row" style={{ alignItems: "flex-start" }}>
                <SafeImage src={line.image} alt="" width={48} height={60} style={{ borderRadius: "var(--r-xs)", objectFit: "cover" }} />
                <div style={{ flex: 1 }}>
                  <p className="text-sm" style={{ fontWeight: 600 }}>
                    {L(line.title)} ×{line.quantity}
                  </p>
                  <p className="text-xs text-muted">
                    {[
                      // Translated, never the raw enum — the summary must not
                      // mix English into an Arabic or Hebrew page.
                      line.version
                        ? t(`product.version${line.version === "fan" ? "Fan" : line.version === "player" ? "Player" : line.version === "kids" ? "Kids" : "Retro"}`)
                        : null,
                      line.sleeve === "long" ? t("product.sleeveLong") : null,
                      line.size,
                      line.personalization ? `${line.personalization.name ?? ""} ${line.personalization.number ?? ""}`.trim() : null,
                      line.badge ? `${L(line.badge.name)} ${formatBadgeAdjustment(line.badge.priceIls)}`.trim() : line.patchName ? L(line.patchName) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Price
                  ils={line.unitPriceIls * line.quantity}
                  compareIls={line.price && line.price.saleDiscountIls > 0 ? line.price.regularUnitPriceIls * line.quantity : undefined}
                  className="text-sm"
                />
                {staleLineKeys.has(line.key) && (
                  <div className="stack stack--sm" style={{ flexBasis: "100%" }}>
                    <p className="field__error" role="alert">
                      {t("checkout.staleLineWarning")}
                    </p>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => cart.remove(line.key)}>
                      {t("cart.remove")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <FreeDeliveryProgress />
          <hr className="divider" style={{ marginBlock: "var(--sp-1)" }} />
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.subtotal")}</span>
            <Price ils={cart.subtotalIls} />
          </div>
          <PromotionLine promotion={cart.promotion} />
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.delivery")}</span>
            {cart.freeDelivery.isFreeDeliveryUnlocked ? (
              <span style={{ color: "var(--ok)", fontWeight: 700 }}>{t("checkout.free")}</span>
            ) : deliveryIls !== null ? (
              <Price ils={deliveryIls} />
            ) : (
              <span className="text-muted">{t("checkout.selectZoneShort")}</span>
            )}
          </div>
          <div className="row row--between" style={{ fontSize: "var(--fs-lg)", fontWeight: 800 }}>
            <span>{t("cart.total")}</span>
            <Price ils={cart.merchandiseTotalIls + (deliveryIls ?? 0)} />
          </div>
          <p className="text-xs text-muted">{t("checkout.hiddenFeesNote")}</p>
          <button type="submit" className="btn btn--gold btn--lg btn--block" disabled={busy}>
            {busy ? t("common.loading") : t("checkout.placeOrder")}
          </button>
        </aside>
      </form>
    </main>
  );
}


