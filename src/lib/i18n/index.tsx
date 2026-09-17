/**
 * Localization core: three fully separated language experiences (ar/he/en),
 * RTL/LTR direction management, dictionary lookup and price formatting.
 * Dictionaries live in ./{ar,he,en}.json — key parity across the three files
 * is enforced by tests/unit/i18n-parity.test.ts.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
export {
  DEFAULT_LOCALE,
  hasTranslation,
  isLocale,
  LOCALES,
  localeDir,
  localeName,
  translator,
  type Locale,
  type TFunction,
} from "./translate.ts";
import { hasTranslation, localeDir, translator, type Locale, type TFunction } from "./translate.ts";

const STORAGE_KEY = "crowned_locale";

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

export function detectPreferredLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLocaleLocal(saved)) return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined") {
    for (const lang of navigator.languages ?? []) {
      const base = lang.slice(0, 2).toLowerCase();
      if (isLocaleLocal(base)) return base;
      if (base === "iw") return "he";
    }
  }
  return "ar";
}

function isLocaleLocal(value: string | undefined): value is Locale {
  return value === "ar" || value === "he" || value === "en";
}

/** ₪ price formatting. Uses western digits (standard for the Israeli market
 * in all three languages) with a bidi-safe shekel prefix. */
export function formatPrice(ils: number): string {
  const n = Number.isInteger(ils)
    ? ils.toLocaleString("en-US")
    : ils.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₪${n}`;
}

interface I18nContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: TFunction;
  /** See {@link hasTranslation} — required before using a server-built key. */
  has: (key: string) => boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDir(locale);
    rememberLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: localeDir(locale), t: translator(locale), has: (key: string) => hasTranslation(locale, key) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <LocaleProvider>");
  return ctx;
}
