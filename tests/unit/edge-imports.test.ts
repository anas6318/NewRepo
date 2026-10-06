/**
 * Edge-import guard (A2-B1).
 *
 * Commit cf06186 added a call to `preflight(req)` in
 * supabase/functions/admin-actions/index.ts without importing `preflight`
 * from _shared/helpers.ts. Deno/TypeScript would only surface that at
 * deploy time (there is no Deno runtime in this environment to catch it),
 * so nothing in CI would have failed until a real request hit the function.
 *
 * This test is a lightweight static check, run over every edge function and
 * shared module, that every bare `name(...)` call site resolves to either:
 *   - an imported binding,
 *   - something declared locally in the file (function/class/const/let/var,
 *     including destructured and typed parameters — collected broadly, see
 *     below), or
 *   - a known JS/Deno/web global.
 *
 * It is intentionally simple (comment/string stripping + regex token
 * scanning, no real TS parser) and deliberately over-inclusive on what
 * counts as "locally declared" — the goal is to catch genuinely undefined
 * calls like the missing `preflight` import, not to be a general linter, so
 * false positives are the failure mode to avoid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** JS/Deno/web globals callable as bare functions in these edge modules. */
const GLOBAL_ALLOWLIST = new Set([
  "Deno",
  "fetch",
  "Response",
  "Request",
  "URL",
  "URLSearchParams",
  "JSON",
  "Math",
  "Date",
  "Number",
  "String",
  "Boolean",
  "Object",
  "Array",
  "Promise",
  "crypto",
  "TextEncoder",
  "TextDecoder",
  "encodeURIComponent",
  "decodeURIComponent",
  "setTimeout",
  "clearTimeout",
  "console",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Error",
  "TypeError",
  "RangeError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Symbol",
  "btoa",
  "atob",
  "structuredClone",
  "Headers",
  "AbortController",
  "AbortSignal",
  "queueMicrotask",
  "globalThis",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
  "DataView",
]);

/** JS keywords that can be immediately followed by `(` but are not calls. */
const KEYWORD_EXCLUDE = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "new",
  "in",
  "of",
  "do",
  "else",
  "try",
  "throw",
  "void",
  "delete",
  "yield",
  "await",
  "async",
  "class",
  "extends",
  "super",
  "this",
  "import",
  "export",
  "default",
  "case",
  "instanceof",
  "with",
  "finally",
  "static",
  "get",
  "set",
]);

/**
 * Strips // and /* *\/ comments and the literal text of strings and
 * template literals, while preserving the executable code inside
 * template-literal `${...}` interpolations (those routinely contain real
 * calls in this codebase, e.g. `${money(order.totalIls)}`).
 */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;

  const skipSimpleString = (quote: string) => {
    i++; // opening quote
    while (i < n && src[i] !== quote) {
      if (src[i] === "\\") i++;
      i++;
    }
    i++; // closing quote
  };

  // A `/` starts a regex literal (not division) when the previous significant
  // token cannot end an expression. Regex bodies may contain quotes (e.g.
  // /^[\p{L}' .-]+$/u), which would otherwise be mistaken for strings.
  const regexAllowed = (): boolean => {
    const prev = out.trimEnd();
    if (prev === "") return true;
    if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(prev)) return true;
    return /\b(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(prev);
  };
  const skipRegex = () => {
    i++; // opening slash
    let inClass = false;
    while (i < n && src[i] !== "\n") {
      const ch = src[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) break;
      i++;
    }
    i++; // closing slash
    while (i < n && /[a-z]/i.test(src[i]!)) i++; // flags
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      out += " ";
      skipRegex();
      continue;
    }
    if (c === "'" || c === '"') {
      out += " ";
      skipSimpleString(c);
      continue;
    }
    if (c === "`") {
      i++;
      out += " ";
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`") {
          i++;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const cc = src[i];
            const cc2 = src[i + 1];
            if (cc === "/" && cc2 === "/") {
              while (i < n && src[i] !== "\n") i++;
              continue;
            }
            if (cc === "/" && cc2 === "*") {
              i += 2;
              while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
              i += 2;
              continue;
            }
            if (cc === "'" || cc === '"') {
              out += " ";
              skipSimpleString(cc);
              continue;
            }
            if (cc === "`") {
              // Nested template literal: skip it wholesale (rare in this codebase).
              i++;
              let tdepth = 0;
              while (i < n) {
                if (src[i] === "\\") {
                  i += 2;
                  continue;
                }
                if (src[i] === "`" && tdepth === 0) {
                  i++;
                  break;
                }
                if (src[i] === "$" && src[i + 1] === "{") {
                  tdepth++;
                  i += 2;
                  continue;
                }
                if (src[i] === "}" && tdepth > 0) {
                  tdepth--;
                  i++;
                  continue;
                }
                i++;
              }
              continue;
            }
            if (cc === "{") {
              depth++;
              out += cc;
              i++;
              continue;
            }
            if (cc === "}") {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
              out += cc;
              i++;
              continue;
            }
            out += cc;
            i++;
          }
          // Separator so back-to-back `${a}${b(...)}` interpolations (no
          // literal text between them) cannot glue into one fake identifier.
          out += " ";
          continue;
        }
        out += " "; // template literal text, stripped but kept as a separator
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const IDENT = "[A-Za-z_$][\\w$]*";

/** Every name that becomes a usable local binding, collected broadly. */
export function collectDeclaredIdentifiers(cleaned: string): Set<string> {
  const declared = new Set<string>();

  // import Default, { a, b as c }, * as ns from "...";
  const importRe = /import\s+(?:type\s+)?([^;]+?)\s+from\s+["'][^"']+["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(cleaned))) {
    const clause = m[1]!;
    // namespace import
    const ns = clause.match(new RegExp(`\\*\\s+as\\s+(${IDENT})`));
    if (ns) declared.add(ns[1]!);
    // named imports block
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1]!.split(",")) {
        const piece = part.trim();
        if (!piece) continue;
        const asMatch = piece.match(new RegExp(`(?:${IDENT})\\s+as\\s+(${IDENT})`));
        const bare = piece.match(new RegExp(`^(${IDENT})`));
        if (asMatch) declared.add(asMatch[1]!);
        else if (bare) declared.add(bare[1]!);
      }
    }
    // default import (leading identifier before a comma or the whole clause)
    const withoutNamed = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+\w+/, "");
    const def = withoutNamed.match(new RegExp(`^\\s*(${IDENT})`));
    if (def) declared.add(def[1]!);
  }

  // function/class/interface/type declarations
  for (const re of [
    new RegExp(`\\bfunction\\s*\\*?\\s*(${IDENT})`, "g"),
    new RegExp(`\\bclass\\s+(${IDENT})`, "g"),
    new RegExp(`\\binterface\\s+(${IDENT})`, "g"),
    new RegExp(`\\btype\\s+(${IDENT})`, "g"),
  ]) {
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(cleaned))) declared.add(mm[1]!);
  }

  // const/let/var <lhs> = ... ; grab every identifier token in the LHS
  // (handles plain names and arbitrarily nested destructuring).
  const declRe = /\b(?:const|let|var)\s+([^=;\n]+?)\s*(?:=|;|\n)/g;
  let dm: RegExpExecArray | null;
  while ((dm = declRe.exec(cleaned))) {
    const lhs = dm[1]!;
    const idents = lhs.match(new RegExp(IDENT, "g")) ?? [];
    for (const id of idents) declared.add(id);
  }

  // Broadly: any identifier sitting in a binding position — right after
  // `(`, `,`, `{`, `[` and right before `:`, `,`, `)`, `}`, `]`, `=`.
  // This sweeps up function/arrow parameters and destructured keys
  // (typed or not) without needing real scope analysis. Over-inclusive
  // by design: it may also catch plain object-literal keys, which is
  // harmless here.
  const bindingRe = new RegExp(`[(,{\\[]\\s*(?:\\.\\.\\.)?\\s*(${IDENT})\\s*(?=[:,)\\]}=])`, "g");
  let bm: RegExpExecArray | null;
  while ((bm = bindingRe.exec(cleaned))) declared.add(bm[1]!);
  // ...and destructured rename targets: `key: renamed`.
  const renameRe = new RegExp(`:\\s*(${IDENT})\\s*(?=[,)\\]}=])`, "g");
  let rm: RegExpExecArray | null;
  while ((rm = renameRe.exec(cleaned))) declared.add(rm[1]!);

  // Any `name(...) {` signature (function declarations already covered,
  // this also picks up class/object method shorthand, defensively).
  const signatureRe = new RegExp(`\\b(${IDENT})\\s*\\([^()]*\\)\\s*(?::[^{=]+)?\\{`, "g");
  let sm: RegExpExecArray | null;
  while ((sm = signatureRe.exec(cleaned))) declared.add(sm[1]!);

  return declared;
}

/** Every bare `name(` call site (never `.name(`), keyword calls excluded. */
export function collectCalledIdentifiers(cleaned: string): Set<string> {
  const called = new Set<string>();
  const callRe = new RegExp(`(?<![.\\w$])(${IDENT})\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(cleaned))) {
    const name = m[1]!;
    if (KEYWORD_EXCLUDE.has(name)) continue;
    called.add(name);
  }
  return called;
}

/** Names called as bare functions but never imported/declared/global. */
export function findMissingIdentifiers(source: string): string[] {
  const cleaned = stripCommentsAndStrings(source);
  const declared = collectDeclaredIdentifiers(cleaned);
  const called = collectCalledIdentifiers(cleaned);
  const missing: string[] = [];
  for (const name of called) {
    if (declared.has(name)) continue;
    if (GLOBAL_ALLOWLIST.has(name)) continue;
    missing.push(name);
  }
  return missing.sort();
}

/* ── Every edge function + shared module, on HEAD ────────────────────────── */

function edgeFiles(): string[] {
  const fnDir = path.join(REPO_ROOT, "supabase", "functions");
  const out: string[] = [];
  for (const entry of readdirSync(fnDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "_shared") {
      const idx = path.join(fnDir, entry.name, "index.ts");
      if (existsSync(idx)) out.push(idx);
    }
  }
  const sharedDir = path.join(fnDir, "_shared");
  for (const entry of readdirSync(sharedDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(path.join(sharedDir, entry.name));
  }
  return out;
}

test("every edge function and _shared module has no unresolved bare calls (HEAD)", () => {
  const files = edgeFiles();
  assert.ok(files.length >= 10, "sanity: expected to find the edge function files");
  const problems: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const missing = findMissingIdentifiers(source);
    if (missing.length > 0) {
      problems.push(`${path.relative(REPO_ROOT, file)}: ${missing.join(", ")}`);
    }
  }
  assert.deepEqual(problems, [], `unresolved bare call(s):\n${problems.join("\n")}`);
});

/* ── Proof: this guard actually catches the A2-B1 bug ────────────────────── */

const BASELINE_SHA = "c532a2bd7b15a8be75a273972be5059061995369";

test("the guard FAILS on the pre-fix baseline content and PASSES on HEAD (A2-B1 proof)", () => {
  const baselineSource = execFileSync("git", ["show", `${BASELINE_SHA}:supabase/functions/admin-actions/index.ts`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const baselineMissing = findMissingIdentifiers(baselineSource);
  assert.ok(baselineMissing.includes("preflight"), `expected baseline to be missing "preflight", got: ${baselineMissing.join(", ")}`);

  const headSource = readFileSync(path.join(REPO_ROOT, "supabase", "functions", "admin-actions", "index.ts"), "utf8");
  const headMissing = findMissingIdentifiers(headSource);
  assert.deepEqual(headMissing, [], `HEAD admin-actions/index.ts should have no unresolved bare calls, got: ${headMissing.join(", ")}`);
});

/* ── Regex literals containing quotes must not derail the stripper ─────────── */

test("regex literals with quotes do not hide later declarations or calls", () => {
  const src = [
    "export const NAME = /^[\p{L}\p{M}' .-]{1,14}$/u;",
    'const other = /"[a-z]+"/g;',
    "const half = total / 2;",
    "const fail = (e: string) => ({ ok: false, e });",
    "export function check(v: string) {",
    "  if (!NAME.test(v)) return fail('bad');",
    "  return missingHelper(v);",
    "}",
  ].join("\n");
  assert.deepEqual(findMissingIdentifiers(src), ["missingHelper"]);
});
