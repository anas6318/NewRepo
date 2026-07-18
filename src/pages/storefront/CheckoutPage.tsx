/** Checkout (spec §14/§15): guest + account, zone-based delivery, honest
 * payment methods (only enabled+configured methods appear), full order
 * summary with no hidden fees. Totals recompute server-side on placement. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { useCart, useSession, useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { s } from "../../lib/schema.ts";
import { resolveDeliveryFee } from "../../lib/delivery.ts";
import type { PaymentMethodId } from "../../services/types.ts";
import { Field } from "../../components/product/ReviewsSection.tsx";
import { FreeDeliveryProgress } from "../../components/product/FreeDeliveryProgress.tsx";
import { EmptyState, Price, useL } from "../../components/ui/bits.tsx";
import { IconBag } from "../../components/ui/Icons.tsx";

const checkoutSchema = s.object({
  name: s.string().trim().min(2).max(60),
  email: s.string().trim().email(),
  phone: s.string().trim().phone(),
  city: s.string().trim().min(2).max(40),
  address: s.string().trim().min(4).max(160),
  notes: s.string().max(500).optional(),
});

export function CheckoutPage() {
  const { locale, t } = useI18n();
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
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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
    setServerError(null);
    const parsed = checkoutSchema.safeParse(fields);
    const map: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.issues) map[issue.path] = translateIssue(issue.message, t);
    if (!zoneId) map.zone = t("checkout.selectZone");
    if (!method) map.method = t("checkout.selectPayment");
    if (!policyAck) map.policyAck = t("checkout.policyAckRequired");
    setErrors(map);
    if (Object.keys(map).length > 0 || !parsed.success) {
      document.getElementById("checkout-errors")?.focus();
      return;
    }

    setSubmitting(true);
    track("add_shipping_info", { zone: zoneId });
    track("add_payment_info", { method });
    const res = await dataService().placeOrder({
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
        patchId: l.patchId,
        quantity: l.quantity,
      })),
      marketingConsent: consent,
    });
    setSubmitting(false);

    if (!res.ok || !res.orderNumber) {
      setServerError(t(`checkout.error_${res.error ?? "generic"}`, {}) || t("common.error"));
      return;
    }
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
            {method === "bank_transfer" && settings && (
              <div className="card stack--sm stack" style={{ background: "var(--paper)", padding: "var(--sp-4)" }}>
                <strong className="text-sm">{t("checkout.bankTransferInfoTitle")}</strong>
                <p className="text-sm text-muted" style={{ whiteSpace: "pre-line" }}>
                  {L(settings.bankTransferInstructions)}
                </p>
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
                <img src={line.image} alt="" width={48} height={60} style={{ borderRadius: "var(--r-xs)", objectFit: "cover" }} />
                <div style={{ flex: 1 }}>
                  <p className="text-sm" style={{ fontWeight: 600 }}>
                    {L(line.title)} ×{line.quantity}
                  </p>
                  <p className="text-xs text-muted">
                    {[
                      line.version,
                      line.sleeve === "long" ? t("product.sleeveLong") : null,
                      line.size,
                      line.personalization ? `${line.personalization.name ?? ""} ${line.personalization.number ?? ""}`.trim() : null,
                      line.patchName ? L(line.patchName) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Price ils={line.unitPriceIls * line.quantity} className="text-sm" />
              </li>
            ))}
          </ul>
          <FreeDeliveryProgress />
          <hr className="divider" style={{ marginBlock: "var(--sp-1)" }} />
          <div className="row row--between text-sm">
            <span className="text-muted">{t("cart.subtotal")}</span>
            <Price ils={cart.subtotalIls} />
          </div>
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
            <Price ils={cart.subtotalIls + (deliveryIls ?? 0)} />
          </div>
          <p className="text-xs text-muted">{t("checkout.hiddenFeesNote")}</p>
          <button type="submit" className="btn btn--gold btn--lg btn--block" disabled={submitting}>
            {submitting ? t("common.loading") : t("checkout.placeOrder")}
          </button>
        </aside>
      </form>
    </main>
  );
}

function translateIssue(message: string, t: (k: string) => string): string {
  if (message === "Required") return t("errors.required");
  if (message === "Invalid email address") return t("errors.invalidEmail");
  if (message === "Invalid phone number") return t("errors.invalidPhone");
  return message;
}
