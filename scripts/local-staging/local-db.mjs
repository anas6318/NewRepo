/**
 * SQL against the LOCAL Supabase Postgres container only (there is no psql
 * on the host). Statements go in on stdin of
 * `docker exec -i supabase_db_crowned-local psql …`; nothing is interpolated
 * into a shell command line.
 *
 * Callers must have passed the local-staging guard first (guard.mjs).
 */
import { spawnSync } from "node:child_process";

/** `supabase_db_<project_id>` — project_id is `crowned-local` (supabase/config.toml). */
export const DB_CONTAINER = "supabase_db_crowned-local";

/**
 * Runs SQL as the local `postgres` superuser. Returns raw output; with
 * `tuples` (default) rows are unaligned, `|`-separated, no headers.
 * @param {string} sql
 * @param {{ tuples?: boolean, allowError?: boolean }} [opts]
 */
export function psql(sql, { tuples = true, allowError = false } = {}) {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"];
  if (tuples) args.push("-A", "-t");
  const res = spawnSync("docker", args, {
    input: `set client_encoding = 'UTF8';\n${sql}\n`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    timeout: 120_000,
  });
  const out = { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  if (out.status !== 0 && !allowError) {
    throw new Error(`psql failed (exit ${out.status}): ${out.stderr.trim().slice(0, 800)}`);
  }
  return out;
}

/** First column of every row, trimmed. */
export function psqlRows(sql) {
  return psql(sql)
    .stdout.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** A single scalar value (first row, first column) as a string. */
export function psqlScalar(sql) {
  const rows = psqlRows(sql);
  return rows[0] ?? "";
}

/** Dollar-quoted SQL literal for arbitrary text (JSON included). */
export function dollarQuote(text) {
  const s = String(text);
  let tag = "it";
  let n = 0;
  while (s.includes(`$${tag}$`)) tag = `it${++n}`;
  return `$${tag}$${s}$${tag}$`;
}

/** SQL text literal with single quotes doubled. */
export function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
