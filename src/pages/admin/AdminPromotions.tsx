/**
 * Admin: cart promotions.
 *
 * A promotion is a basket-level rule, kept deliberately separate from a
 * product's own Sale section: a sale reduces one product's price, a
 * promotion looks at the whole cart. Everything about a campaign — the
 * percentage, the qualifying quantity, the schedule, which products take
 * part, the labels — is data, so nothing here requires a code change.
 *
 * Authorization is enforced in the data layer (demo: requireStaff();
 * supabase: RLS + the admin-actions edge function). This screen is
 * convenience only.
 */
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import type { LocalizedText, Product, PromotionConfig } from "../../services/types.ts";
import {
  DEFAULT_PROMOTION_LABEL,
  promotionStatus,
  PROMOTION_DEFAULTS,
  resolvePromotion,
  validatePromotion,
  type PromotionLine,
  type PromotionStatus,
} from "../../lib/promotions.ts";
import { DEFAULT_TIMEZONE } from "../../lib/sales.ts";
import { demoCategories } from "../../services/demo/seed-data.ts";

const STATUS_COPY: Record<PromotionStatus, { text: string; cls: string }> = {
  disabled: { text: "Disabled — no cart is discounted", cls: "badge--muted" },
  scheduled: { text: "Scheduled — not applied yet", cls: "badge--warn" },
  running: { text: "Running — qualifying carts are discounted now", cls: "badge--ok" },
  expired: { text: "Ended — no cart is discounted", cls: "badge--muted" },
  invalid: { text: "Invalid — fix the errors below; nothing is discounted meanwhile", cls: "badge--err" },
};

/** `datetime-local` needs "YYYY-MM-DDTHH:mm" in the store's zone. */
function toLocalInput(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Interprets a wall-clock value in the store's zone and returns UTC ISO. */
function fromLocalInput(value: string, timeZone: string): string | undefined {
  if (!value) return undefined;
  const naive = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naive)) return undefined;
  const local = new Date(naive);
  const offsetMs = new Date(local.toLocaleString("en-US", { timeZone })).getTime() - new Date(local.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(naive - offsetMs).toISOString();
}

function blankPromotion(index: number): PromotionConfig {
  return {
    id: `promo-${Date.now()}`,
    ...PROMOTION_DEFAULTS,
    label: { ...DEFAULT_PROMOTION_LABEL },
    sortOrder: (index + 1) * 10,
  };
}

export function AdminPromotions() {
  const [promotions, setPromotions] = useState<PromotionConfig[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    document.title = "Promotions · CROWNED admin";
    dataService()
      .adminListPromotions()
      .then(setPromotions)
      .catch((e) => {
        setPromotions([]);
        toast.push(String(e), "error");
      });
    dataService().adminListProducts().then(setProducts).catch(() => undefined);
    dataService()
      .getSettings()
      .then((s) => setTimeZone(s.timezone || DEFAULT_TIMEZONE))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = useMemo(() => (promotions ?? []).flatMap((p) => validatePromotion(p)), [promotions]);

  if (!promotions) return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;

  const mutate = (next: PromotionConfig[]) => {
    setPromotions(next);
    setDirty(true);
  };
  const set = (i: number, patch: Partial<PromotionConfig>) => mutate(promotions.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const setLabel = (i: number, lang: keyof LocalizedText, value: string) =>
    set(i, { label: { ...promotions[i]!.label, [lang]: value } });

  const save = async () => {
    if (errors.length) {
      toast.push(errors[0]!, "error");
      return;
    }
    const res = await dataService().adminSavePromotions(promotions);
    if (res.ok) {
      toast.push("Promotions saved");
      setDirty(false);
    } else toast.push(res.error ?? "Save failed", "error");
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between row--wrap">
        <div>
          <h1 className="section__title">Promotions</h1>
          <p className="text-sm text-muted">
            Cart-level campaigns. A promotion looks at the whole basket; a product&apos;s own discount lives in its Sale section. Being in a promotion never
            means a product is confirmed available with the supplier.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => mutate([...promotions, blankPromotion(promotions.length)])}>
            Add campaign
          </button>
          <button type="button" className="btn btn--gold" onClick={() => void save()} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="card stack--sm stack" style={{ borderColor: "var(--danger)" }} role="alert">
          <strong className="text-sm">Fix before saving</strong>
          {errors.map((e) => (
            <p key={e} className="text-xs">
              {e}
            </p>
          ))}
        </div>
      )}

      {promotions.length === 0 && <p className="text-muted">No campaigns yet. Add one to offer a multi-item promotion.</p>}

      {promotions.map((promo, i) => (
        <PromotionEditor
          key={promo.id}
          promo={promo}
          products={products}
          timeZone={timeZone}
          onChange={(patch) => set(i, patch)}
          onLabel={(lang, value) => setLabel(i, lang, value)}
          onRemove={() => mutate(promotions.filter((_, idx) => idx !== i))}
        />
      ))}
    </div>
  );
}

function PromotionEditor({
  promo,
  products,
  timeZone,
  onChange,
  onLabel,
  onRemove,
}: {
  promo: PromotionConfig;
  products: Product[];
  timeZone: string;
  onChange: (patch: Partial<PromotionConfig>) => void;
  onLabel: (lang: keyof LocalizedText, value: string) => void;
  onRemove: () => void;
}) {
  const status = promotionStatus(promo);
  const problems = validatePromotion(promo);

  const toggleIn = (list: string[] | undefined, id: string): string[] => {
    const set = new Set(list ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    return [...set];
  };

  /** A worked example on a representative basket, so the owner can see the
   * rule behave before switching it on. Uses the campaign exactly as
   * configured — the same resolver the storefront and server use. */
  const preview = useMemo(() => {
    const prices = [140, 130, 120, 100];
    const lines: PromotionLine[] = prices.map((v, idx) => ({
      lineKey: `preview-${idx}`,
      productId: `preview-${idx}`,
      slug: `preview-${idx}`,
      title: { ar: "", he: "", en: `Item ${idx + 1}` },
      quantity: 1,
      merchandiseUnitIls: v,
      hasProductSale: false,
    }));
    // Preview the rule itself, so a scheduled or disabled campaign still
    // demonstrates its behaviour without pretending it is live.
    const asRunning: PromotionConfig = { ...promo, enabled: true, startsAt: undefined, endsAt: undefined };
    return resolvePromotion([asRunning], lines);
  }, [promo]);

  return (
    <section className="card stack" aria-label={`Promotion ${promo.label.en || promo.id}`}>
      <div className="row row--between row--wrap">
        <h2 className="drawer__title">{promo.label.en || "New campaign"}</h2>
        <div className="row">
          <span className={`badge ${STATUS_COPY[status].cls}`}>{STATUS_COPY[status].text}</span>
          <button type="button" className="btn btn--danger btn--sm" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={promo.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span>Enabled</span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Discount percentage (%)</span>
          <input className="input num" type="number" min={1} max={100} step={1} value={promo.discountPercent} onChange={(e) => onChange({ discountPercent: Number(e.target.value) })} />
          <span className="field__hint">Taken off the cheaper item of each qualifying group.</span>
        </label>
        <label className="field">
          <span className="field__label">Minimum qualifying quantity</span>
          <input className="input num" type="number" min={2} step={1} value={promo.minimumQuantity} onChange={(e) => onChange({ minimumQuantity: Number(e.target.value) })} />
          <span className="field__hint">2 = &ldquo;buy 2&rdquo;. Counts units, so quantity 2 of one product qualifies.</span>
        </label>
        <label className="field">
          <span className="field__label">Starts ({timeZone})</span>
          <input className="input num" type="datetime-local" value={toLocalInput(promo.startsAt, timeZone)} onChange={(e) => onChange({ startsAt: fromLocalInput(e.target.value, timeZone) })} />
          <span className="field__hint">Blank = starts immediately once the campaign is on. Stored in UTC.</span>
        </label>
        <label className="field">
          <span className="field__label">Ends ({timeZone})</span>
          <input className="input num" type="datetime-local" value={toLocalInput(promo.endsAt, timeZone)} onChange={(e) => onChange({ endsAt: fromLocalInput(e.target.value, timeZone) })} />
          <span className="field__hint">Blank = no end. It stops exactly at this time, with no redeploy.</span>
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={promo.repeatPerPair} onChange={(e) => onChange({ repeatPerPair: e.target.checked })} />
        <span>Repeat per pair — every further complete group earns another discount</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={promo.stackWithProductSales} onChange={(e) => onChange({ stackWithProductSales: e.target.checked })} />
        <span>
          Allow stacking with product sales — off by default, so an item already reduced by its own sale is not discounted twice
        </span>
      </label>

      <div className="form-grid">
        {(["en", "ar", "he"] as const).map((lang) => (
          <label className="field" key={lang}>
            <span className="field__label">Customer-facing label ({lang.toUpperCase()})</span>
            <input className="input" dir={lang === "en" ? "ltr" : "rtl"} value={promo.label[lang]} onChange={(e) => onLabel(lang, e.target.value)} />
          </label>
        ))}
      </div>

      <details className="stack--sm stack">
        <summary className="text-sm" style={{ cursor: "pointer" }}>
          Eligible products ({(promo.eligibleProductIds ?? []).length || "all"}), categories ({(promo.eligibleCategorySlugs ?? []).length || "none"}), exclusions (
          {(promo.excludedProductIds ?? []).length})
        </summary>
        <p className="text-xs text-muted">
          Leave products and categories empty to include the whole catalog. Exclusions always win.
        </p>
        <div className="form-grid">
          <fieldset className="field">
            <legend className="field__label">Eligible categories</legend>
            {demoCategories.map((c) => (
              <label className="check" key={c.slug}>
                <input
                  type="checkbox"
                  checked={(promo.eligibleCategorySlugs ?? []).includes(c.slug)}
                  onChange={() => onChange({ eligibleCategorySlugs: toggleIn(promo.eligibleCategorySlugs, c.slug) })}
                />
                <span>{c.name.en}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="field">
            <legend className="field__label">Eligible products</legend>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {products.map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={(promo.eligibleProductIds ?? []).includes(p.id)}
                    onChange={() => onChange({ eligibleProductIds: toggleIn(promo.eligibleProductIds, p.id) })}
                  />
                  <span className="text-xs">{p.name.en || p.slug}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend className="field__label">Excluded products</legend>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {products.map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={(promo.excludedProductIds ?? []).includes(p.id)}
                    onChange={() => onChange({ excludedProductIds: toggleIn(promo.excludedProductIds, p.id) })}
                  />
                  <span className="text-xs">{p.name.en || p.slug}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      {problems.length > 0 && (
        <div className="card stack--sm stack" style={{ borderColor: "var(--danger)" }} role="alert">
          {problems.map((e) => (
            <p key={e} className="text-xs">
              {e}
            </p>
          ))}
        </div>
      )}

      <div className="card stack--sm stack">
        <strong className="text-sm">Behaviour preview</strong>
        <p className="text-xs text-muted">
          A basket of ₪140, ₪130, ₪120 and ₪100 of eligible merchandise, with this campaign running:
        </p>
        {preview && preview.discountedUnits > 0 ? (
          <>
            <p className="text-sm">
              <strong>{preview.discountedUnits}</strong> item{preview.discountedUnits === 1 ? "" : "s"} discounted ·{" "}
              <bdi dir="ltr">−₪{preview.discountIls}</bdi> · merchandise <bdi dir="ltr">₪{preview.originalMerchandiseIls}</bdi> →{" "}
              <bdi dir="ltr">₪{preview.finalMerchandiseIls}</bdi>
            </p>
            <p className="text-xs text-muted">
              Discounted: {preview.allocations.map((a) => `₪${a.unitMerchandiseIls} (−₪${a.discountIls})`).join(", ")}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">This configuration would not discount that basket.</p>
        )}
        <p className="text-xs text-muted">
          Badge/patch charges and delivery are never part of the calculation. Name and number printing is free and so cannot be discounted.
        </p>
      </div>
    </section>
  );
}
