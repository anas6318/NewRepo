import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import type { Product } from "../../services/types.ts";
import { CatalogResults } from "../../components/product/CatalogGrid.tsx";
import { useL } from "../../components/ui/bits.tsx";
import { IconSearch } from "../../components/ui/Icons.tsx";

export function SearchPage() {
  const { locale, t } = useI18n();
  const L = useL();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const [results, setResults] = useState<Product[] | null>(urlQuery ? null : []);
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [fallback, setFallback] = useState<Product[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  usePageMeta({ title: t("nav.search"), path: "/search", locale, noindex: true });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* live suggestions while typing */
  useEffect(() => {
    clearTimeout(debounce.current);
    if (input.trim().length < 2 || input === urlQuery) {
      setSuggestions([]);
      setHighlight(-1);
      return;
    }
    debounce.current = setTimeout(() => {
      dataService()
        .searchSuggestions(input.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 180);
    return () => clearTimeout(debounce.current);
  }, [input, urlQuery]);

  /* committed search from URL */
  useEffect(() => {
    let alive = true;
    if (!urlQuery) {
      setResults([]);
      return;
    }
    setResults(null);
    track("search", { search_term_length: urlQuery.length });
    dataService()
      .listProducts({ query: urlQuery })
      .then((p) => {
        if (!alive) return;
        setResults(p);
        if (p.length === 0) {
          dataService().listProducts({ featured: true }).then((f) => alive && setFallback(f.slice(0, 4))).catch(() => undefined);
        }
      })
      .catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [urlQuery]);

  const commit = (value: string) => {
    setSuggestions([]);
    setHighlight(-1);
    const next = new URLSearchParams(params);
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    setParams(next, { replace: false });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHighlight((h) => (e.key === "ArrowDown" ? (h + 1) % suggestions.length : (h - 1 + suggestions.length) % suggestions.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = highlight >= 0 ? suggestions[highlight] : undefined;
      if (chosen) {
        window.history.pushState(null, "", `/${locale}/product/${chosen.slug}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else {
        commit(input);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  };

  return (
    <main id="main" className="container section--tight section">
      <h1 className="section__title mb-6">{t("nav.search")}</h1>
      <div className="search-box" role="search">
        <div className="search-box__field">
          <IconSearch size={18} />
          <label className="sr-only" htmlFor="search-input">
            {t("search.placeholder")}
          </label>
          <input
            id="search-input"
            ref={inputRef}
            className="input"
            type="search"
            placeholder={t("search.placeholder")}
            value={input}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={highlight >= 0 ? `sugg-${highlight}` : undefined}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="btn btn--gold" onClick={() => commit(input)}>
            {t("nav.search")}
          </button>
        </div>
        {suggestions.length > 0 && (
          <ul className="search-box__suggestions" id="search-suggestions" role="listbox">
            {suggestions.map((p, i) => (
              <li key={p.id} role="option" id={`sugg-${i}`} aria-selected={i === highlight}>
                <Link to={`/${locale}/product/${p.slug}`} className={`search-sugg${i === highlight ? " is-active" : ""}`}>
                  <img src={p.images[0]?.src ?? ""} alt="" width={40} height={50} />
                  <span>{L(p.name)}</span>
                  <bdi className="text-muted">₪{p.basePriceIls}</bdi>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8">
        {urlQuery ? (
          <>
            <p className="text-sm text-muted mb-6" aria-live="polite">
              {results ? t("search.resultsFor", { count: results.length, query: urlQuery }) : t("common.loading")}
            </p>
            <CatalogResults products={results} />
            {results?.length === 0 && fallback.length > 0 && (
              <div className="mt-8 stack">
                <h2 className="section__title" style={{ fontSize: "var(--fs-xl)" }}>
                  {t("search.tryThese")}
                </h2>
                <CatalogResults products={fallback} />
              </div>
            )}
          </>
        ) : (
          <p className="text-muted">{t("search.hint")}</p>
        )}
      </div>
    </main>
  );
}
