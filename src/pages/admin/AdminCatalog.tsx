/** Admin: product management + supplier import (spec §25/§26). */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import { translator } from "../../lib/i18n/index.tsx";
import type {
  AvailabilityState,
  BadgeOption,
  ImportRowResult,
  JerseyVersion,
  LocalizedText,
  Product,
  ProductBadgeSetting,
  ProductImage,
  ProductImageRole,
  SaleConfig,
  SaleStatus,
  SaleType,
} from "../../services/types.ts";
import { productBadgeSettings, resolveProductBadges } from "../../lib/badges.ts";
import { coverImage, orderImages, productMedia, setRoleImage } from "../../lib/media.ts";
import { DEFAULT_TIMEZONE, productDiscountable, resolveSale, saleStatus, validateSale } from "../../lib/sales.ts";
import { demoCategories, ADULT_SIZES, KIDS_SIZES } from "../../services/demo/seed-data.ts";
import {
  AVAILABILITY_FRESH_DAYS,
  chartIdFor,
  confirmationExpiresAt,
  confirmationFreshness,
  resolveAvailability,
  SIZE_RULES,
  sizeKey,
} from "../../services/sizing.ts";

export function AdminProducts() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const toast = useToast();

  const load = () => {
    dataService()
      .adminListProducts()
      .then(setProducts)
      .catch((e) => toast.push(String(e), "error"));
  };
  useEffect(() => {
    document.title = "Products · CROWNED admin";
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      (products ?? []).filter(
        (p) =>
          (!status || p.status === status) &&
          (!query || `${p.slug} ${p.name.en} ${p.name.ar} ${p.name.he}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [products, query, status],
  );

  const duplicate = async (p: Product) => {
    const copy: Product = structuredClone(p);
    copy.id = `dup-${Date.now()}`;
    copy.slug = `${p.slug}-copy`;
    copy.status = "draft";
    copy.name = { ar: `${p.name.ar} (نسخة)`, he: `${p.name.he} (עותק)`, en: `${p.name.en} (copy)` };
    const res = await dataService().adminSaveProduct(copy);
    if (res.ok) {
      toast.push("Duplicated as draft");
      load();
    } else toast.push(res.error ?? "Failed", "error");
  };

  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <h1 className="section__title">Products {products && <span className="text-muted">({products.length})</span>}</h1>
        <button type="button" className="btn btn--gold" onClick={() => navigate("/admin/products/new")}>
          + New product
        </button>
      </div>
      <div className="row row--wrap">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search products…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search products" />
        <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {["available", "made_to_order", "unavailable", "draft", "archived"].map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
              <th scope="col">Rights</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="row">
                    {coverImage(p)?.src && <img src={coverImage(p)!.src} alt="" width={36} height={45} style={{ borderRadius: 4, objectFit: "cover" }} />}
                    <div>
                      <strong>{p.name.en}</strong>
                      <br />
                      <span className="text-xs text-muted num">{p.slug}</span>
                    </div>
                  </div>
                </td>
                <td>{p.categorySlug}</td>
                <td className="num">₪{p.basePriceIls}</td>
                <td>
                  <StatusChip status={p.status} />
                </td>
                <td>
                  <span className={`badge ${p.rightsStatus === "cleared" ? "badge--ok" : p.rightsStatus === "blocked" ? "badge--err" : "badge--warn"}`}>{p.rightsStatus}</span>
                </td>
                <td>
                  <div className="row" style={{ gap: "var(--sp-1)" }}>
                    <Link to={`/admin/products/${p.id}`} className="btn btn--outline btn--sm">
                      Edit
                    </Link>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void duplicate(p)}>
                      Duplicate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Product["status"] }) {
  const cls = status === "draft" ? "badge--warn" : status === "archived" ? "badge--muted" : status === "unavailable" ? "badge--err" : "badge--ok";
  return <span className={`badge ${cls}`}>{status}</span>;
}

const EMPTY_L: LocalizedText = { ar: "", he: "", en: "" };

function blankProduct(): Product {
  return {
    id: `new-${Date.now()}`,
    slug: "",
    categorySlug: "retro",
    name: { ...EMPTY_L },
    description: { ...EMPTY_L },
    details: { ...EMPTY_L },
    seoTitle: { ...EMPTY_L },
    seoDescription: { ...EMPTY_L },
    status: "draft",
    basePriceIls: 170,
    versions: [],
    sleeves: ["short"],
    longSleeveAdjustmentIls: 0,
    sizes: [...ADULT_SIZES],
    personalizable: true,
    // No hard-coded badge list: a new product starts with none enabled and
    // the owner opts in under Badge / patch options below.
    patchIds: [],
    badges: [],
    allowNoBadge: true,
    qualifiesForFreeDelivery: true,
    featured: false,
    images: [],
    relatedSlugs: [],
    tags: [],
    rightsStatus: "pending_review",
    // Publishing is not supplier confirmation: a new product is unconfirmed
    // until someone actually checks with the supplier.
    availability: { status: "confirmation_required" },
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
}

export function AdminProductEdit({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [lang, setLang] = useState<"en" | "ar" | "he">("en");
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === "new";

  useEffect(() => {
    document.title = "Edit product · CROWNED admin";
    if (isNew) {
      setProduct(blankProduct());
      return;
    }
    dataService()
      .adminListProducts()
      .then((all) => setProduct(all.find((p) => p.id === id) ?? null))
      .catch(() => setProduct(null));
  }, [id, isNew]);

  if (!product) return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;

  const set = <K extends keyof Product>(key: K, value: Product[K]) => setProduct((p) => (p ? { ...p, [key]: value } : p));
  const setL = (key: "name" | "description" | "details" | "seoTitle" | "seoDescription", value: string) =>
    setProduct((p) => (p ? { ...p, [key]: { ...p[key], [lang]: value } } : p));

  const save = async () => {
    if (!product.slug.trim() || !product.name.en.trim() || product.basePriceIls <= 0) {
      toast.push("Slug, English name and a positive price are required.", "error");
      return;
    }
    const res = await dataService().adminSaveProduct(product);
    if (res.ok) {
      toast.push("Saved");
      navigate("/admin/products");
    } else {
      toast.push(res.error === "rights_not_cleared" ? "Cannot publish: product rights must be cleared first (set Rights status to cleared after review)." : (res.error ?? "Save failed"), "error");
    }
  };

  const remove = async () => {
    await dataService().adminDeleteProduct(product.id);
    toast.push("Deleted");
    navigate("/admin/products");
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between row--wrap">
        <h1 className="section__title">{isNew ? "New product" : `Edit: ${product.name.en || product.slug}`}</h1>
        <div className="row">
          {!isNew && (
            <button type="button" className="btn btn--danger btn--sm" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn--gold" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>

      <section className="card stack" aria-label="Core">
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Slug (URL)</span>
            <input className="input num" dir="ltr" value={product.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} />
          </label>
          <label className="field">
            <span className="field__label">Category</span>
            <select className="select" value={product.categorySlug} onChange={(e) => set("categorySlug", e.target.value)}>
              {demoCategories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name.en}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Base price (₪)</span>
            <input className="input num" type="number" min={1} value={product.basePriceIls} onChange={(e) => set("basePriceIls", Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">Status</span>
            <select className="select" value={product.status} onChange={(e) => set("status", e.target.value as Product["status"])}>
              {["draft", "made_to_order", "available", "unavailable", "archived"].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Rights status</span>
            <select className="select" value={product.rightsStatus} onChange={(e) => set("rightsStatus", e.target.value as Product["rightsStatus"])}>
              {["pending_review", "cleared", "blocked"].map((rs) => (
                <option key={rs} value={rs}>
                  {rs}
                </option>
              ))}
            </select>
            <span className="field__hint">Products cannot leave draft until rights are cleared (enforced on save).</span>
          </label>
          <label className="field">
            <span className="field__label">Era (e.g. 2000s)</span>
            <input className="input" value={product.era ?? ""} onChange={(e) => set("era", e.target.value || undefined)} />
          </label>
          <label className="field">
            <span className="field__label">Season (e.g. 25/26)</span>
            <input className="input" value={product.season ?? ""} onChange={(e) => set("season", e.target.value || undefined)} />
          </label>
        </div>
        <div className="row row--wrap">
          <label className="check">
            <input type="checkbox" checked={product.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured
          </label>
          <label className="check">
            <input type="checkbox" checked={product.nationalTeam ?? false} onChange={(e) => set("nationalTeam", e.target.checked)} /> National team
          </label>
          <label className="check">
            <input type="checkbox" checked={product.kids ?? false} onChange={(e) => { set("kids", e.target.checked); set("sizes", e.target.checked ? [...KIDS_SIZES] : [...ADULT_SIZES]); }} /> Kids
          </label>
          <label className="check">
            <input type="checkbox" checked={product.personalizable} onChange={(e) => set("personalizable", e.target.checked)} /> Personalizable
          </label>
          <label className="check">
            <input type="checkbox" checked={product.qualifiesForFreeDelivery} onChange={(e) => set("qualifiesForFreeDelivery", e.target.checked)} /> Counts toward free delivery
          </label>
        </div>
      </section>

      <section className="card stack" aria-label="Translations">
        <div className="tabs" role="tablist" aria-label="Content language">
          {(["en", "ar", "he"] as const).map((lng) => (
            <button key={lng} type="button" role="tab" aria-selected={lang === lng} onClick={() => setLang(lng)}>
              {lng === "en" ? "English" : lng === "ar" ? "العربية" : "עברית"}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Name ({lang})</span>
          <input className="input" dir={lang === "en" ? "ltr" : "rtl"} value={product.name[lang]} onChange={(e) => setL("name", e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Description ({lang})</span>
          <textarea className="textarea" dir={lang === "en" ? "ltr" : "rtl"} value={product.description[lang]} onChange={(e) => setL("description", e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Details / care ({lang})</span>
          <textarea className="textarea" dir={lang === "en" ? "ltr" : "rtl"} value={product.details[lang]} onChange={(e) => setL("details", e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">SEO title ({lang})</span>
            <input className="input" dir={lang === "en" ? "ltr" : "rtl"} value={product.seoTitle[lang]} onChange={(e) => setL("seoTitle", e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">SEO description ({lang})</span>
            <input className="input" dir={lang === "en" ? "ltr" : "rtl"} value={product.seoDescription[lang]} onChange={(e) => setL("seoDescription", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card stack" aria-label="Variants">
        <h2 className="drawer__title">Variants & options</h2>
        <div className="row row--wrap">
          {(["fan", "player"] as const).map((v) => {
            const on = product.versions.some((x) => x.version === v);
            return (
              <label key={v} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    set(
                      "versions",
                      e.target.checked ? [...product.versions, { version: v, adjustmentIls: v === "player" ? 20 : 0 }] : product.versions.filter((x) => x.version !== v),
                    )
                  }
                />
                {v} version
                {on && (
                  <input
                    className="input num"
                    type="number"
                    style={{ width: 90, marginInlineStart: 8 }}
                    aria-label={`${v} price adjustment`}
                    value={product.versions.find((x) => x.version === v)?.adjustmentIls ?? 0}
                    onChange={(e) => set("versions", product.versions.map((x) => (x.version === v ? { ...x, adjustmentIls: Number(e.target.value) } : x)))}
                  />
                )}
              </label>
            );
          })}
        </div>
        <div className="row row--wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={product.sleeves.includes("long")}
              onChange={(e) => set("sleeves", e.target.checked ? ["short", "long"] : ["short"])}
            />
            Long-sleeve option
          </label>
          {product.sleeves.includes("long") && (
            <label className="row text-sm">
              adjustment ₪
              <input className="input num" type="number" style={{ width: 90 }} value={product.longSleeveAdjustmentIls} onChange={(e) => set("longSleeveAdjustmentIls", Number(e.target.value))} />
            </label>
          )}
        </div>
        <label className="field">
          <span className="field__label">
            Sizes (comma-separated) — allowed for {chartIdFor(product)}: {SIZE_RULES[chartIdFor(product)].allowed.join(", ")}
          </span>
          <input
            className="input"
            dir="ltr"
            value={product.sizes.join(", ")}
            onChange={(e) => {
              const next = String(e.target.value).split(",").map((s: string) => s.trim()).filter(Boolean);
              // A newly enabled size has never been checked with the supplier.
              const added = next.filter((sz) => !product.sizes.includes(sz));
              if (added.length) {
                const sa = { ...(product.sizeAvailability ?? {}) };
                for (const sz of added) if (!sa[sizeKey(undefined, sz)]) sa[sizeKey(undefined, sz)] = { status: "confirmation_required" };
                set("sizeAvailability", sa);
              }
              set("sizes", next);
            }}
          />
          <span className="field__hint">
            4XL is opt-in per product and has no supplier-confirmed measurements — it always shows a confirmation notice to the customer.
          </span>
        </label>

        <SupplierAvailabilityEditor product={product} set={set} />
      </section>

      <ProductMediaEditor product={product} set={set} />

      <ProductSaleEditor product={product} set={set} />

      <ProductBadgeEditor product={product} set={set} />

      <section className="card stack" aria-label="Supplier (never shown to customers)">
        <h2 className="drawer__title">Supplier (internal only)</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Supplier SKU</span>
            <input className="input num" dir="ltr" value={product.supplier?.sku ?? ""} onChange={(e) => set("supplier", { ...product.supplier, sku: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Supplier reference</span>
            <input className="input num" dir="ltr" value={product.supplier?.reference ?? ""} onChange={(e) => set("supplier", { ...product.supplier, reference: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Supplier cost (USD)</span>
            <input className="input num" type="number" value={product.supplier?.costUsd ?? ""} onChange={(e) => set("supplier", { ...product.supplier, costUsd: Number(e.target.value) || undefined })} />
          </label>
        </div>
      </section>
    </div>
  );
}

export function AdminImport() {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<Record<string, string>[] | null>(null);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "Supplier import · CROWNED admin";
  }, []);

  const parse = () => {
    setResults(null);
    try {
      const trimmed = raw.trim();
      if (!trimmed) return;
      let rows: Record<string, string>[];
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        const json = JSON.parse(trimmed) as Record<string, string>[] | Record<string, string>;
        rows = Array.isArray(json) ? json : [json];
      } else {
        rows = parseCsv(trimmed);
      }
      setPreview(rows);
    } catch (e) {
      toast.push(`Parse failed: ${String(e)}`, "error");
      setPreview(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    const res = await dataService().adminImportProducts(preview);
    setResults(res.results);
    toast.push(`${res.created} product(s) created as DRAFT`);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <h1 className="section__title">Supplier product import</h1>
      <p className="text-sm text-muted">
        Upload CSV or JSON (or paste below). Imported products always start as <strong>draft</strong> with rights status <strong>pending_review</strong> and
        availability <strong>confirmation_required</strong> — nothing publishes automatically, and appearing in the supplier catalog is never treated as live
        inventory. Columns: <code className="num">slug, name_en, name_ar, name_he, desc_en, desc_ar, desc_he, category, price_ils, sizes, badge_codes, badge_price_overrides, supplier_sku, supplier_ref, supplier_cost_usd, personalizable</code>.
        Template: <code className="num">docs/supplier-import-template.csv</code>.
      </p>
      <p className="text-sm text-muted">
        <code className="num">badge_codes</code> is optional and pipe- or comma-separated (for example <code className="num">league|ucl</code>). It may only
        reference internal codes that already exist under <strong>Badge / patch options</strong> — an import never creates a badge from supplier text. Unknown
        codes are reported on the row and skipped. <code className="num">badge_price_overrides</code> takes <code className="num">code:price</code> pairs (for
        example <code className="num">ucl:12</code>) and applies only to that product; anything else inherits the global price.
      </p>
      <p className="text-sm text-muted">
        <code className="num">sizes</code> is optional and pipe- or comma-separated. Supplier aliases (P, G, GG, XG, 2XG) are normalised to public labels; sizes
        that do not exist for the product type are rejected with the row reported, never silently dropped. Left blank, the product type&apos;s default set is used
        (fan reaches 3XL; 4XL stays opt-in per product).
      </p>
      <input type="file" accept=".csv,.json,text/csv,application/json" className="input" onChange={onFile} aria-label="Upload CSV or JSON file" />
      <textarea className="textarea num" dir="ltr" style={{ minHeight: 160 }} placeholder="slug,name_en,category,price_ils…" value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Import data" />
      <div className="row">
        <button type="button" className="btn btn--dark" onClick={parse}>
          Preview
        </button>
        {preview && (
          <button type="button" className="btn btn--gold" onClick={() => void commit()}>
            Import {preview.length} row(s) as drafts
          </button>
        )}
      </div>

      {preview && !results && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {Object.keys(preview[0] ?? {}).slice(0, 7).map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  {Object.keys(preview[0] ?? {}).slice(0, 7).map((h) => (
                    <td key={h} className="num">
                      {row[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && (
        <div className="stack stack--sm">
          <h2 className="drawer__title">Import results</h2>
          {results.map((r) => (
            <p key={r.row} className={`text-sm ${r.ok ? "" : "field__error"}`}>
              Row {r.row}: {r.ok ? `✓ created draft "${r.slug}"` : r.errors.join("; ")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* ── Supplier availability editor ────────────────────────────────────────
   Catalog presence is not inventory. The owner records what the supplier
   actually confirmed, at product / version / size level, plus when it was
   checked and an internal note. Nothing here is ever shown to customers
   except the resolved state itself. */
const AVAILABILITY_STATES: AvailabilityState[] = ["available", "confirmation_required", "unavailable", "discontinued"];

/** Shows whether a stored confirmation is still trusted by the storefront. */
function FreshnessBadge({ record }: { record?: { status: AvailabilityState; lastCheckedAt?: string } }) {
  if (!record || record.status !== "available") return null;
  const state = confirmationFreshness(record);
  const checked = record.lastCheckedAt ? new Date(record.lastCheckedAt).toLocaleDateString("en-GB") : "never";
  if (state === "confirmed") {
    const until = confirmationExpiresAt(record);
    return (
      <span className="badge badge--ok">
        Confirmed · checked {checked}
        {until ? ` · valid until ${new Date(until).toLocaleDateString("en-GB")}` : ""}
      </span>
    );
  }
  return (
    <span className="badge badge--warn">
      Confirmation expired · recheck required{record.lastCheckedAt ? ` · last checked ${checked}` : " · never checked"}
    </span>
  );
}

/* ── Sale for one product ─────────────────────────────────────────────────
   A sale is configuration layered on top of the regular price, never a
   rewrite of it. Turning the sale off restores the regular price with no
   further action, because the regular price was never touched.

   Datetime-local inputs are entered and shown in the store's timezone; the
   values stored are always UTC ISO strings. */
/** `datetime-local` needs "YYYY-MM-DDTHH:mm" in the store's zone. */
function toLocalInput(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Interprets a wall-clock value in the store's zone and returns UTC ISO. */
function fromLocalInput(value: string, timeZone: string): string | undefined {
  if (!value) return undefined;
  const naive = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naive)) return undefined;
  // Offset of the target zone at that instant, derived without extra deps.
  const local = new Date(naive);
  const asZone = new Date(local.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asZone.getTime() - asUtc.getTime();
  return new Date(naive - offsetMs).toISOString();
}

/* ── Product images / media ────────────────────────────────────────────────
   The styled preview and the real photograph are roles on entries of the
   ordinary `images` array, so nothing here can disturb the gallery, and
   saving touches `images` and nothing else. Order is kept canonical (styled,
   real, then the gallery) so every consumer that treats `images[0]` as the
   cover — cart lines, order snapshots, prerendered metadata — stays right
   without needing to know about roles. */

const AR = translator("ar");
const HE = translator("he");

/** Distinct alt text per role, so a screen reader can tell the presentation
 * image and the photograph apart. */
function altForRole(name: LocalizedText, role: ProductImageRole): LocalizedText {
  if (role === "styled") return name;
  return {
    ar: `${name.ar} — ${AR("media.real")}`,
    he: `${name.he} — ${HE("media.real")}`,
    en: `${name.en} — Real Product`,
  };
}

function RoleImageField({
  role,
  label,
  help,
  image,
  onChange,
}: {
  role: ProductImageRole;
  label: string;
  help: string;
  image: ProductImage | undefined;
  onChange: (src: string) => void;
}) {
  const customerTerm = role === "styled" ? "media.styled" : "media.real";
  return (
    <div className="media-admin__slot">
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="input num"
          dir="ltr"
          placeholder="https://…"
          value={image?.src ?? ""}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <span className="field__hint">{help}</span>
        <span className="field__hint">
          Customers see this labelled “{role === "styled" ? "Styled Preview" : "Real Product"}” · {AR(customerTerm)} · {HE(customerTerm)}
        </span>
      </label>
      <div className="media-admin__preview">
        {image?.src ? (
          <img src={image.src} alt={`${label} preview`} width={96} height={120} />
        ) : (
          <span className="media-admin__empty">Not set</span>
        )}
        {image?.src && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function ProductMediaEditor({
  product,
  set,
}: {
  product: Product;
  set: <K extends keyof Product>(key: K, value: Product[K]) => void;
}) {
  const media = productMedia(product);
  // Read from the raw array, not `media.extras`: a row the owner has just
  // added is still blank and must not vanish while they paste into it.
  const extras = product.images.filter((i) => i !== media.styled && i !== media.real);

  const setRole = (role: ProductImageRole, src: string) =>
    set("images", setRoleImage(product.images, role, src ? { src, alt: altForRole(product.name, role) } : undefined));

  const writeExtras = (next: ProductImage[]) =>
    set("images", orderImages([...(media.styled ? [media.styled] : []), ...(media.real ? [media.real] : []), ...next]));

  const editExtra = (i: number, src: string) =>
    writeExtras(extras.map((img, j) => (j === i ? { ...img, src } : img)));

  const moveExtra = (i: number, delta: number) => {
    const next = [...extras];
    const target = i + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[i]!;
    const b = next[target]!;
    next[i] = b;
    next[target] = a;
    writeExtras(next);
  };

  return (
    <section className="card stack" aria-label="Product images">
      <h2 className="drawer__title">Product images</h2>
      <p className="field__hint">
        Owner-supplied or authorized assets only. These URLs are public. Never paste a supplier’s private
        catalogue link here — supplier references belong in the internal section below and are never sent to
        customers.
      </p>

      <div className="media-admin">
        <RoleImageField
          role="styled"
          label="Styled Preview Image"
          help="Premium presentation image used for the storefront. This may be AI-generated or professionally styled."
          image={media.styled}
          onChange={(src) => setRole("styled", src)}
        />
        <RoleImageField
          role="real"
          label="Real Product Image"
          help="Actual photograph of the product customers will receive."
          image={media.real}
          onChange={(src) => setRole("real", src)}
        />
      </div>

      <p className="field__hint">
        {media.canSwitch
          ? "Both set — customers can switch between them on the shop cards and the product page."
          : media.views.length === 1
            ? `Only the ${media.views[0] === "styled" ? "styled preview" : "real photograph"} is set. It is shown on its own and labelled honestly; no switch appears until both exist.`
            : "Neither is set. The images below are shown unlabelled, exactly as before."}
      </p>

      <div className="stack">
        <h3 className="field__label">Gallery images (back, close-ups, badge and personalization shots)</h3>
        {extras.length === 0 && <span className="field__hint">No additional gallery images.</span>}
        {extras.map((img, i) => (
          <div className="media-admin__row" key={i}>
            <input
              className="input num"
              dir="ltr"
              aria-label={`Gallery image ${i + 1} URL`}
              value={img.src}
              onChange={(e) => editExtra(i, e.target.value.trim())}
            />
            <div className="row">
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Move gallery image ${i + 1} up`} disabled={i === 0} onClick={() => moveExtra(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={`Move gallery image ${i + 1} down`}
                disabled={i === extras.length - 1}
                onClick={() => moveExtra(i, 1)}
              >
                ↓
              </button>
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove gallery image ${i + 1}`} onClick={() => writeExtras(extras.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => writeExtras([...extras, { src: "", alt: product.name }])}>
            Add gallery image
          </button>
        </div>
      </div>
    </section>
  );
}

function ProductSaleEditor({
  product,
  set,
}: {
  product: Product;
  set: <K extends keyof Product>(key: K, value: Product[K]) => void;
}) {
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);
  useEffect(() => {
    dataService()
      .getSettings()
      .then((s) => setTimeZone(s.timezone || DEFAULT_TIMEZONE))
      .catch(() => undefined);
  }, []);

  const sale: SaleConfig = product.sale ?? { enabled: false, type: "none" };
  const setSale = (patch: Partial<SaleConfig>) => set("sale", { ...sale, ...patch });
  const setLabel = (lang: "en" | "ar" | "he", value: string) =>
    setSale({ label: { ar: "", he: "", en: "", ...sale.label, [lang]: value } });

  // What the sale would actually reduce, for the product's first version.
  const discountable = productDiscountable(product, product.versions[0]?.version, sale.includeAddOns === true);
  const errors = validateSale(sale, discountable);
  const status = saleStatus(sale, discountable);
  const preview = resolveSale(sale, discountable);
  const finalIls = preview && preview.status === "active" ? Math.round((discountable - preview.discountIls) * 100) / 100 : discountable;

  const STATUS_COPY: Record<SaleStatus, { text: string; cls: string }> = {
    disabled: { text: "Disabled — selling at the regular price", cls: "badge--muted" },
    scheduled: { text: "Scheduled — not applied yet", cls: "badge--warn" },
    active: { text: "Active — customers see the sale price now", cls: "badge--ok" },
    expired: { text: "Expired — the regular price is back", cls: "badge--muted" },
    invalid: { text: "Invalid — fix the errors below; the regular price is charged meanwhile", cls: "badge--err" },
  };

  return (
    <section className="card stack" aria-label="Sale">
      <div className="row row--between row--wrap">
        <h2 className="drawer__title">Sale</h2>
        <span className={`badge ${STATUS_COPY[status].cls}`}>{STATUS_COPY[status].text}</span>
      </div>

      <p className="text-sm text-muted">
        The regular price (₪{product.basePriceIls}) is never overwritten. Turning the sale off restores it immediately. A sale says nothing about supplier
        availability — a discounted product can still be awaiting confirmation.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={sale.enabled}
          onChange={(e) => setSale({ enabled: e.target.checked, type: e.target.checked && sale.type === "none" ? "percentage" : sale.type })}
        />
        <span>Sale enabled</span>
      </label>

      {sale.enabled && (
        <>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Sale type</span>
              <select className="select" value={sale.type === "none" ? "percentage" : sale.type} onChange={(e) => setSale({ type: e.target.value as SaleType })}>
                <option value="percentage">Percentage off</option>
                <option value="fixed_amount">Fixed amount off (₪)</option>
                <option value="fixed_price">Fixed sale price (₪)</option>
              </select>
            </label>
            {sale.type === "percentage" && (
              <label className="field">
                <span className="field__label">Percentage off (%)</span>
                <input className="input num" type="number" min={1} max={100} step={1} value={sale.percentOff ?? ""} onChange={(e) => setSale({ percentOff: Number(e.target.value) })} />
              </label>
            )}
            {sale.type === "fixed_amount" && (
              <label className="field">
                <span className="field__label">Amount off (₪)</span>
                <input className="input num" type="number" min={1} step={1} value={sale.amountOffIls ?? ""} onChange={(e) => setSale({ amountOffIls: Number(e.target.value) })} />
              </label>
            )}
            {sale.type === "fixed_price" && (
              <label className="field">
                <span className="field__label">Final sale price (₪)</span>
                <input className="input num" type="number" min={0} step={1} value={sale.salePriceIls ?? ""} onChange={(e) => setSale({ salePriceIls: Number(e.target.value) })} />
              </label>
            )}
            <label className="field">
              <span className="field__label">Starts ({timeZone})</span>
              <input className="input num" type="datetime-local" value={toLocalInput(sale.startsAt, timeZone)} onChange={(e) => setSale({ startsAt: fromLocalInput(e.target.value, timeZone) })} />
              <span className="field__hint">Blank = starts immediately. Stored in UTC.</span>
            </label>
            <label className="field">
              <span className="field__label">Ends ({timeZone})</span>
              <input className="input num" type="datetime-local" value={toLocalInput(sale.endsAt, timeZone)} onChange={(e) => setSale({ endsAt: fromLocalInput(e.target.value, timeZone) })} />
              <span className="field__hint">Blank = no end. The sale stops exactly at this time, with no redeploy.</span>
            </label>
          </div>

          <div className="form-grid">
            {(["en", "ar", "he"] as const).map((lang) => (
              <label className="field" key={lang}>
                <span className="field__label">Sale label ({lang.toUpperCase()})</span>
                <input
                  className="input"
                  dir={lang === "en" ? "ltr" : "rtl"}
                  placeholder={lang === "en" ? "Limited-time offer" : lang === "ar" ? "عرض لفترة محدودة" : "מבצע לזמן מוגבל"}
                  value={sale.label?.[lang] ?? ""}
                  onChange={(e) => setLabel(lang, e.target.value)}
                />
              </label>
            ))}
          </div>

          <label className="check">
            <input type="checkbox" checked={sale.autoPercentLabel === true} onChange={(e) => setSale({ autoPercentLabel: e.target.checked })} />
            <span>Use the automatic percentage label when no label is written (e.g. &ldquo;20% off&rdquo;)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={sale.showBeforeStart === true} onChange={(e) => setSale({ showBeforeStart: e.target.checked })} />
            <span>Announce the sale before it starts (shows the start date; never a discounted price)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={sale.includeAddOns === true} onChange={(e) => setSale({ includeAddOns: e.target.checked })} />
            <span>Also discount paid add-ons (badge, long sleeve). Off by default — the sale applies to the base price and version adjustment only.</span>
          </label>

          {errors.length > 0 && (
            <div className="card stack--sm stack" style={{ borderColor: "var(--danger)" }} role="alert">
              {errors.map((e) => (
                <p key={e} className="text-xs">
                  {e}
                </p>
              ))}
            </div>
          )}

          <div className="card stack--sm stack" style={{ background: "var(--bg-sunken, transparent)" }}>
            <strong className="text-sm">Customer preview</strong>
            <p className="text-sm">
              {status === "active" ? (
                <>
                  <bdi dir="ltr" style={{ textDecoration: "line-through", opacity: 0.6 }}>
                    ₪{discountable}
                  </bdi>{" "}
                  <bdi dir="ltr" style={{ fontWeight: 800 }}>
                    ₪{finalIls}
                  </bdi>{" "}
                  {preview?.label.en && <span className="badge badge--sale">{preview.label.en}</span>}
                </>
              ) : (
                <>
                  <bdi dir="ltr" style={{ fontWeight: 800 }}>
                    ₪{discountable}
                  </bdi>{" "}
                  <span className="text-muted">— no discount shown while the sale is {status}</span>
                </>
              )}
            </p>
            <p className="text-xs text-muted">
              Applies to ₪{discountable} (base + version adjustment{sale.includeAddOns ? " + paid add-ons" : ""}). Badge and other add-on charges are added after
              the discount{sale.includeAddOns ? " only when add-on eligibility is off" : ""}.
            </p>
          </div>

          <button
            type="button"
            className="btn btn--outline btn--sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => set("sale", { enabled: false, type: "none" })}
          >
            Remove sale (keeps the regular price)
          </button>
        </>
      )}
    </section>
  );
}

/* ── Badge / patch options for one product ────────────────────────────────
   Enablement and price overrides only. The options themselves (names,
   descriptions, default prices, global on/off) live in the shared catalog
   under Admin → Badge / patch options. */
function ProductBadgeEditor({
  product,
  set,
}: {
  product: Product;
  set: <K extends keyof Product>(key: K, value: Product[K]) => void;
}) {
  const [catalog, setCatalog] = useState<BadgeOption[] | null>(null);

  useEffect(() => {
    dataService()
      .adminListBadges()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // Reading through the shared resolver means a product still on the legacy
  // `patchIds` shape shows its real current settings, not an empty list.
  const settings = productBadgeSettings(product);
  const settingFor = (id: string) => settings.find((s) => s.badgeId === id);

  const write = (next: ProductBadgeSetting[]) => set("badges", next);
  const update = (badgeId: string, patch: Partial<ProductBadgeSetting>) => {
    const existing = settingFor(badgeId);
    write(
      existing
        ? settings.map((s) => (s.badgeId === badgeId ? { ...s, ...patch } : s))
        : [...settings, { badgeId, enabled: false, ...patch }],
    );
  };

  if (!catalog) return <div className="skeleton" style={{ height: 140 }} aria-busy="true" />;

  const offered = resolveProductBadges(product, catalog);

  return (
    <section className="card stack" aria-label="Badge / patch options">
      <div className="row row--between row--wrap">
        <h2 className="drawer__title">Badge / patch options</h2>
        <Link to="/admin/badges" className="btn btn--outline btn--sm">
          Manage global options
        </Link>
      </div>

      {catalog.length === 0 && <p className="text-sm text-muted">No badge options exist yet. Create them under Badge / patch options first.</p>}

      <label className="check">
        <input type="checkbox" checked={product.allowNoBadge !== false} onChange={(e) => set("allowNoBadge", e.target.checked)} />
        <span>Allow &ldquo;No badge&rdquo; (recommended)</span>
      </label>

      <label className="field" style={{ maxWidth: 320 }}>
        <span className="field__label">Default selected option</span>
        <select className="select" value={product.defaultBadgeId ?? ""} onChange={(e) => set("defaultBadgeId", e.target.value || undefined)}>
          <option value="">No badge</option>
          {offered.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name.en}
            </option>
          ))}
        </select>
      </label>

      <ul style={{ listStyle: "none", padding: 0 }} className="stack--sm stack">
        {catalog.map((badge) => {
          const setting = settingFor(badge.id);
          const enabled = setting?.enabled ?? false;
          const override = setting?.priceOverrideIls;
          const effective = typeof override === "number" ? override : badge.priceIls;
          return (
            <li key={badge.id} className="stack--sm stack" style={{ borderBlockStart: "1px solid var(--line)", paddingBlockStart: "var(--sp-3)" }}>
              <div className="row row--between row--wrap">
                <label className="check">
                  <input type="checkbox" checked={enabled} onChange={(e) => update(badge.id, { enabled: e.target.checked })} />
                  <span>
                    Enabled for this product — <strong>{badge.name.en || badge.code}</strong>
                  </span>
                </label>
                {!badge.active && <span className="badge badge--warn">Disabled globally</span>}
              </div>
              <div className="row row--wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-end" }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={typeof override !== "number"}
                    onChange={(e) => update(badge.id, { priceOverrideIls: e.target.checked ? undefined : badge.priceIls })}
                    disabled={!enabled}
                  />
                  <span>Inherit global price (₪{badge.priceIls})</span>
                </label>
                {typeof override === "number" && (
                  <label className="field" style={{ maxWidth: 200 }}>
                    <span className="field__label">Product price override (₪)</span>
                    <input
                      className="input num"
                      type="number"
                      min={0}
                      step={1}
                      value={override}
                      onChange={(e) => update(badge.id, { priceOverrideIls: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-muted">
                {enabled && badge.active ? (
                  <>
                    Customer sees: <strong>{badge.name.en || badge.code}</strong> <bdi dir="ltr">{effective > 0 ? `+₪${effective}` : "included"}</bdi>
                    {typeof override === "number" ? " (product override)" : " (global price)"}
                  </>
                ) : (
                  "Not offered on this product."
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SupplierAvailabilityEditor({
  product,
  set,
}: {
  product: Product;
  set: <K extends keyof Product>(key: K, value: Product[K]) => void;
}) {
  const today = () => new Date().toISOString();
  const productState = product.availability?.status ?? resolveAvailability(product, undefined, undefined).status;
  const versions = product.versions.map((v) => v.version);

  const setProductAvailability = (patch: Partial<NonNullable<Product["availability"]>>) =>
    set("availability", { status: productState, ...product.availability, ...patch });

  const setVersionAvailability = (version: JerseyVersion, status: AvailabilityState) =>
    set("versionAvailability", {
      ...product.versionAvailability,
      [version]: { ...(product.versionAvailability?.[version] ?? {}), status, lastCheckedAt: status === "available" ? today() : undefined },
    });

  const setSizeAvailability = (version: JerseyVersion | undefined, size: string, status: AvailabilityState) => {
    const key = sizeKey(version, size);
    const next = { ...(product.sizeAvailability ?? {}) };
    next[key] = { ...(next[key] ?? {}), status, lastCheckedAt: status === "available" ? today() : undefined };
    set("sizeAvailability", next);
  };

  const clearSizeAvailability = (version: JerseyVersion | undefined, size: string) => {
    const next = { ...(product.sizeAvailability ?? {}) };
    delete next[sizeKey(version, size)];
    set("sizeAvailability", next);
  };

  return (
    <section className="card stack" aria-label="Supplier availability">
      <h3 className="drawer__title">Supplier availability</h3>
      <p className="text-xs text-muted">
        A jersey appearing in the supplier catalog does not mean every version and size is available, and publishing a product does not confirm anything.
        Everything defaults to <strong>confirmation_required</strong>; only mark <strong>available</strong> after you actually checked with the supplier — the
        check date is recorded and an <strong>available</strong> state with no date is treated as unconfirmed. A product-level <strong>available</strong> never
        overrides a version or size you marked unavailable.
      </p>

      <div className="row row--wrap">
        <FreshnessBadge record={product.availability} />
        {product.availability?.status === "available" && (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setProductAvailability({ status: "available", lastCheckedAt: today() })}
          >
            Reconfirm availability with supplier
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        A confirmation stays valid for {AVAILABILITY_FRESH_DAYS} days. After that the storefront treats it as
        <strong> confirmation_required</strong> again until you recheck — your stored decision is kept, not erased.
      </p>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Product availability</span>
          <select
            className="select"
            value={productState}
            onChange={(e) => {
              const status = e.target.value as AvailabilityState;
              // "available" is a claim that someone checked — stamp the date.
              setProductAvailability({ status, lastCheckedAt: status === "available" ? today() : product.availability?.lastCheckedAt });
            }}
          >
            {AVAILABILITY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Last supplier check</span>
          <input
            className="input num"
            type="date"
            value={product.availability?.lastCheckedAt?.slice(0, 10) ?? ""}
            onChange={(e) => setProductAvailability({ lastCheckedAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Internal supplier note (never shown to customers)</span>
        <textarea className="textarea" value={product.availability?.supplierNote ?? ""} onChange={(e) => setProductAvailability({ supplierNote: e.target.value })} />
      </label>

      {versions.length > 0 && (
        <div className="stack--sm stack">
          <span className="field__label">Per-version availability</span>
          {versions.map((v) => (
            <div key={v} className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
              <strong style={{ minWidth: 90 }}>{v}</strong>
              <select
                className="select"
                style={{ maxWidth: 220 }}
                aria-label={`${v} availability`}
                value={product.versionAvailability?.[v]?.status ?? ""}
                onChange={(e) => (e.target.value ? setVersionAvailability(v, e.target.value as AvailabilityState) : undefined)}
              >
                <option value="">— inherit product —</option>
                {AVAILABILITY_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <FreshnessBadge record={product.versionAvailability?.[v]} />
              {product.versionAvailability?.[v]?.status === "available" && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setVersionAvailability(v, "available")}>
                  Reconfirm
                </button>
              )}
              <span className="text-xs text-muted">
                sizes: {(product.versionSizes?.[v] ?? product.sizes).join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="stack--sm stack">
        <span className="field__label">Per-size availability</span>
        <p className="text-xs text-muted">Blank inherits the version, then the product. Fan availability never implies Player availability.</p>
        {(versions.length ? versions : [undefined]).map((v) => (
          <div key={v ?? "all"} className="stack--sm stack">
            {v && <strong className="text-sm">{v}</strong>}
            <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
              {(v ? (product.versionSizes?.[v] ?? product.sizes) : product.sizes).map((sz) => {
                const current = product.sizeAvailability?.[sizeKey(v, sz)]?.status ?? "";
                return (
                  <label key={sz} className="row text-xs" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 700, minWidth: 30 }}>{sz}</span>
                    <select
                      className="select"
                      style={{ width: 150, paddingBlock: "0.3rem" }}
                      aria-label={`${v ?? "all versions"} ${sz} availability`}
                      value={current}
                      onChange={(e) => (e.target.value ? setSizeAvailability(v, sz, e.target.value as AvailabilityState) : clearSizeAvailability(v, sz))}
                    >
                      <option value="">inherit</option>
                      {AVAILABILITY_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
