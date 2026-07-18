import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src", "lib", "i18n");

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys = keys.concat(flatten(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, `${locale}.json`), "utf8")) as Record<string, unknown>;
}

test("ar/he/en dictionaries have identical key sets (no mixed-language pages — spec §4)", () => {
  const ar = new Set(flatten(load("ar")));
  const he = new Set(flatten(load("he")));
  const en = new Set(flatten(load("en")));
  assert.equal(ar.size, en.size, "ar/en size mismatch");
  assert.equal(he.size, en.size, "he/en size mismatch");
  for (const key of en) {
    assert.ok(ar.has(key), `ar missing ${key}`);
    assert.ok(he.has(key), `he missing ${key}`);
  }
});

test("no empty translation values", () => {
  for (const locale of ["ar", "he", "en"]) {
    const dict = load(locale);
    const walk = (obj: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(obj)) {
        const p = path ? `${path}.${key}` : key;
        if (value && typeof value === "object") walk(value as Record<string, unknown>, p);
        else assert.ok(String(value).trim().length > 0, `${locale}:${p} is empty`);
      }
    };
    walk(dict, "");
  }
});

test("interpolation placeholders match across locales", () => {
  const dicts = { ar: load("ar"), he: load("he"), en: load("en") };
  const get = (dict: Record<string, unknown>, path: string): string => {
    let node: unknown = dict;
    for (const part of path.split(".")) node = (node as Record<string, unknown>)[part];
    return String(node);
  };
  for (const key of flatten(dicts.en)) {
    const vars = (get(dicts.en, key).match(/\{[a-z]+\}/gi) ?? []).sort().join(",");
    for (const locale of ["ar", "he"] as const) {
      const other = (get(dicts[locale], key).match(/\{[a-z]+\}/gi) ?? []).sort().join(",");
      assert.equal(other, vars, `${locale}:${key} placeholder mismatch`);
    }
  }
});
