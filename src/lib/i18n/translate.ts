/**
 * The pure translation core: dictionaries, lookup, interpolation.
 *
 * Deliberately a .ts module with no JSX and no React, so tests can import it
 * directly under `node --experimental-strip-types`. index.tsx re-exports
 * everything here, so callers are unaffected.
 */
import ar from "./ar.json" with { type: "json" };
import he from "./he.json" with { type: "json" };
import en from "./en.json" with { type: "json" };

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

/**
 * Whether a key actually exists in this locale or in the English fallback.
 *
 * `t()` deliberately returns the KEY when nothing is found, which is useful
 * in development and dangerous for keys built from server data: the result is
 * a non-empty string, so `t(key) || fallback` can never reach the fallback
 * and the customer is shown something like "checkout.error_some_new_code".
 * Anywhere a key is assembled from a value this app does not control, check
 * with this first.
 */
export function hasTranslation(locale: Locale, key: string): boolean {
  return lookup(DICTS[locale], key) !== undefined || lookup(DICTS.en, key) !== undefined;
}

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
