/**
 * Localization core: three fully separated language experiences (ar/he/en),
 * RTL/LTR direction management, dictionary lookup and price formatting.
 * Dictionaries live in ./{ar,he,en}.json — key parity across the three files
 * is enforced by tests/unit/i18n-parity.test.ts.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import ar from "./ar.json";
import he from "./he.json";
import en from "./en.json";

export type Locale = "ar" | "he" | "en";
export const LOCALES: Locale[] = ["ar", "he", "en"];
export const DEFAULT_LOCALE: Locale = "ar";

const DICTS: Record<Locale, Record<string, unknown>> = { ar, he, en };

export function isLocale(value: string | undefined): value is Locale {
  return value === "ar" || value === "he" || value === "en";
}

export function localeDir(locale: Locale): "rtl" | "ltr" {
  return locale === "en" ? "ltr" : "rtl";
}

export function localeName(locale: Locale): string {
  return locale === "ar" ? "العربية" : locale === "he" ? "עברית" : "English";
}

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
    if (saved && isLocale(saved)) return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined") {
    for (const lang of navigator.languages ?? []) {
      const base = lang.slice(0, 2).toLowerCase();
      if (isLocale(base)) return base;
      if (base === "iw") return "he";
    }
  }
  return DEFAULT_LOCALE;
}

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): TFunction {
  return (key, vars) => {
    let text = lookup(DICTS[locale], key) ?? lookup(DICTS.en, key) ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
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
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDir(locale);
    rememberLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: localeDir(locale), t: translator(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <LocaleProvider>");
  return ctx;
}
