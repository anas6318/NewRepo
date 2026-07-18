/** Shared catalog machinery: URL-synced filters + sorted grid (spec §19). */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { dataService } from "../../services/index.ts";
import type { Product, ProductFilters } from "../../services/types.ts";
import { ProductCard } from "./ProductCard.tsx";
import { EmptyState } from "../ui/bits.tsx";
import { IconSearch } from "../ui/Icons.tsx";
import { ADULT_SIZES, KIDS_SIZES } from "../../services/demo/seed-data.ts";

export function useCatalog(base: ProductFilters) {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<Product[] | null>(null);

  // Callers pass `base` as a fresh object literal each render — key by value
  // so the memo/effect chain stays stable (no refetch loops).
  const baseKey = JSON.stringify(base);

  const filters = useMemo<ProductFilters>(() => {
    const f: ProductFilters = { ...(JSON.parse(baseKey) as ProductFilters) };
    const g = (k: string) => params.get(k) ?? undefined;
    if (g("version")) f.version = g("version") as ProductFilters["version"];
    if (g("size")) f.size = g("size");
    if (g("sleeve")) f.sleeve = g("sleeve") as ProductFilters["sleeve"];
    if (g("audience")) f.audience = g("audience") as ProductFilters["audience"];
    if (g("era")) f.era = g("era");
    if (g("price") === "under150") f.priceMax = 149;
    if (g("price") === "150to200") {
      f.priceMin = 150;
      f.priceMax = 200;
    }
    if (g("price") === "over200") f.priceMin = 201;
    if (g("personalizable") === "1") f.personalizable = true;
    if (g("q")) f.query = g("q");
    if (!f.sort) f.sort = (g("sort") as ProductFilters["sort"]) ?? "featured";
    if (g("sort")) f.sort = g("sort") as ProductFilters["sort"];
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseKey is the value identity of base
  }, [params, baseKey]);

  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let alive = true;
    setProducts(null);
    dataService()
      .listProducts(filters)
      .then((p) => alive && setProducts(p))
      .catch((e) => {
        console.error("[crowned] catalog load failed:", e);
        if (alive) setProducts([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the value identity of filters
  }, [filterKey]);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

  return { products, filters, params, setFilter };
}

export function FilterBar({
  params,
  setFilter,
  showAudience = true,
}: {
  params: URLSearchParams;
  setFilter: (key: string, value: string | null) => void;
  showAudience?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const active = ["version", "size", "sleeve", "audience", "era", "price", "personalizable"].filter((k) => params.get(k)).length;

  return (
    <div className="filterbar">
      <div className="row row--between row--wrap">
        <button type="button" className="btn btn--outline btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("filters.title")}
          {active > 0 && <span className="count-dot" style={{ position: "static", marginInlineStart: 6 }}>{active}</span>}
        </button>
        <label className="row text-sm" style={{ gap: "var(--sp-2)" }}>
          <span className="text-muted">{t("filters.sort")}</span>
          <select className="select" style={{ width: "auto", paddingBlock: "0.4rem" }} value={params.get("sort") ?? "featured"} onChange={(e) => setFilter("sort", e.target.value === "featured" ? null : e.target.value)}>
            <option value="featured">{t("filters.sortFeatured")}</option>
            <option value="newest">{t("filters.sortNewest")}</option>
            <option value="price_asc">{t("filters.sortPriceAsc")}</option>
            <option value="price_desc">{t("filters.sortPriceDesc")}</option>
          </select>
        </label>
      </div>

      {open && (
        <div className="filterbar__panel">
          <FilterGroup label={t("product.version")}>
            {(["fan", "player"] as const).map((v) => (
              <Chip key={v} on={params.get("version") === v} onClick={() => setFilter("version", params.get("version") === v ? null : v)}>
                {t(`product.version${v === "fan" ? "Fan" : "Player"}`)}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label={t("product.size")}>
            {[...ADULT_SIZES, ...KIDS_SIZES.slice(0, 3)].map((s) => (
              <Chip key={s} on={params.get("size") === s} onClick={() => setFilter("size", params.get("size") === s ? null : s)}>
                {s}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label={t("product.sleeve")}>
            <Chip on={params.get("sleeve") === "long"} onClick={() => setFilter("sleeve", params.get("sleeve") === "long" ? null : "long")}>
              {t("product.sleeveLong")}
            </Chip>
          </FilterGroup>
          {showAudience && (
            <FilterGroup label={t("filters.audience")}>
              <Chip on={params.get("audience") === "adult"} onClick={() => setFilter("audience", params.get("audience") === "adult" ? null : "adult")}>
                {t("filters.adults")}
              </Chip>
              <Chip on={params.get("audience") === "kids"} onClick={() => setFilter("audience", params.get("audience") === "kids" ? null : "kids")}>
                {t("nav.kids")}
              </Chip>
            </FilterGroup>
          )}
          <FilterGroup label={t("filters.era")}>
            {["1990s", "2000s"].map((era) => (
              <Chip key={era} on={params.get("era") === era} onClick={() => setFilter("era", params.get("era") === era ? null : era)}>
                {era}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label={t("filters.price")}>
            {(
              [
                ["under150", t("filters.under150")],
                ["150to200", t("filters.between150200")],
                ["over200", t("filters.over200")],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} on={params.get("price") === value} onClick={() => setFilter("price", params.get("price") === value ? null : value)}>
                {label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label={t("filters.more")}>
            <Chip on={params.get("personalizable") === "1"} onClick={() => setFilter("personalizable", params.get("personalizable") === "1" ? null : "1")}>
              {t("filters.personalizable")}
            </Chip>
          </FilterGroup>
          {active > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                for (const k of ["version", "size", "sleeve", "audience", "era", "price", "personalizable"]) setFilter(k, null);
              }}
            >
              {t("filters.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="filterbar__group">
      <legend className="field__label">{label}</legend>
      <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
        {children}
      </div>
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`chip${on ? " is-selected" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function CatalogResults({ products }: { products: Product[] | null }) {
  const { t } = useI18n();
  if (products === null) {
    return (
      <div className="prod-grid" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="prod-card">
            <div className="skeleton" style={{ aspectRatio: "4 / 5", borderRadius: "var(--r-md)" }} />
            <div className="skeleton" style={{ height: 14, width: "60%" }} />
            <div className="skeleton" style={{ height: 14, width: "30%" }} />
          </div>
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return <EmptyState icon={<IconSearch size={22} />} title={t("shop.noResults")} body={t("shop.noResultsBody")} />;
  }
  return (
    <div className="prod-grid">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} eager={i < 4} />
      ))}
    </div>
  );
}
