/** Admin: product management + supplier import (spec §25/§26). */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import type { ImportRowResult, LocalizedText, Product } from "../../services/types.ts";
import { demoCategories, ADULT_SIZES, KIDS_SIZES } from "../../services/demo/seed-data.ts";

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
                    {p.images[0]?.src && <img src={p.images[0].src} alt="" width={36} height={45} style={{ borderRadius: 4, objectFit: "cover" }} />}
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
    patchIds: ["league-patch", "cup-patch", "champions-patch"],
    qualifiesForFreeDelivery: true,
    featured: false,
    images: [],
    relatedSlugs: [],
    tags: [],
    rightsStatus: "pending_review",
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
          <span className="field__label">Sizes (comma-separated)</span>
          <input className="input" dir="ltr" value={product.sizes.join(", ")} onChange={(e) => set("sizes", String(e.target.value).split(",").map((s: string) => s.trim()).filter(Boolean))} />
        </label>
        <label className="field">
          <span className="field__label">Image URLs (one per line — owner-supplied/authorized assets only)</span>
          <textarea
            className="textarea num"
            dir="ltr"
            value={product.images.map((i) => i.src).join("\n")}
            onChange={(e) =>
              set(
                "images",
                String(e.target.value)
                  .split("\n")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                  .map((src: string) => ({ src, alt: product.name })),
              )
            }
          />
        </label>
      </section>

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
        Upload CSV or JSON (or paste below). Imported products always start as <strong>draft</strong> with rights status <strong>pending_review</strong> — nothing
        publishes automatically. Columns: <code className="num">slug, name_en, name_ar, name_he, desc_en, desc_ar, desc_he, category, price_ils, supplier_sku, supplier_ref, supplier_cost_usd, personalizable</code>.
        Template: <code className="num">docs/supplier-import-template.csv</code>.
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
