/**
 * Emits the size-chart upsert block for migration 0003 straight from
 * src/services/sizing.ts, so the database and the TypeScript source can
 * never drift apart. Run: node scripts/generate-size-chart-sql.mjs
 */
import { CONFIRMED_SIZE_CHARTS } from "../src/services/sizing.ts";

const lines = CONFIRMED_SIZE_CHARTS.map(
  (c) => `  ('${c.id}', '${JSON.stringify(c).replaceAll("'", "''")}'::jsonb)`,
);
console.log(lines.join(",\n"));
