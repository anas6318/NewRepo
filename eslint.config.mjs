/**
 * ESLint flat config.
 *
 * Scope note: in the network-restricted delivery environment only the core
 * eslint binary exists, so this config lints the plain-JS surface (build/
 * test/ops scripts). TypeScript sources are gated by `tsc --noEmit` (strict)
 * — see docs/test-report.md. On a normal machine, extend this with
 * typescript-eslint + eslint-plugin-react-hooks (already familiar patterns;
 * hooks rules were followed by hand and spot-checked in review).
 */
export default [
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Blob: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        btoa: "readonly",
        atob: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-fallthrough": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-shadow": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
  // TypeScript sources (src/) are linted when typescript-eslint is
  // installed (normal machines — it's in devDependencies). In the
  // network-restricted verification environment the packages don't exist,
  // so this block self-disables and `tsc --strict` remains the TS gate.
  ...(await tsBlocks()),
  {
    ignores: ["dist/**", "node_modules/**", "supabase/functions/**", "types-shim/**"],
  },
];

async function tsBlocks() {
  try {
    const ts = (await import("typescript-eslint")).default;
    const reactHooks = (await import("eslint-plugin-react-hooks")).default;
    return [
      ...ts.configs.recommended.map((c) => ({ ...c, files: ["src/**/*.{ts,tsx}"] })),
      {
        files: ["src/**/*.{ts,tsx}"],
        plugins: { "react-hooks": reactHooks },
        rules: {
          ...reactHooks.configs.recommended.rules,
          "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
      },
    ];
  } catch {
    console.warn("[eslint] typescript-eslint not installed — src/ TS linting skipped (tsc is the TS gate here)");
    return [];
  }
}
