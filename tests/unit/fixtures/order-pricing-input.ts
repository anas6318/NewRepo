/**
 * Builds a `PricingInput` for the pure core from the same fixture rows the
 * handler harness serves, so the tamper/parity/core tests and the golden
 * replay all price against identical data.
 */
import type {
  BadgeRow,
  PricingInput,
  ProductRow,
  PromotionConfig,
  StoreSettingsData,
  ZoneRow,
} from "../../../supabase/functions/_shared/order-pricing.ts";
import { GOLDEN_NOW, db, type OrderFixture } from "./order-pricing-cases.ts";

export function pricingInput(body: unknown, fixture: OrderFixture = db(), nowIso: string = GOLDEN_NOW): PricingInput {
  const zoneId = (body as { zoneId?: unknown } | null)?.zoneId;
  return {
    body: JSON.parse(JSON.stringify(body ?? null)) as unknown,
    settings: fixture.settings as unknown as StoreSettingsData | undefined,
    zone: fixture.zones.find((z) => z.id === zoneId) as unknown as ZoneRow | undefined,
    products: new Map(fixture.products.map((p) => [p.id as string, p as unknown as ProductRow])),
    badges: fixture.patches as unknown as BadgeRow[],
    promotions: [...fixture.promotions]
      .sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0))
      .map((r) => r.data as unknown as PromotionConfig),
    nowMs: Date.parse(nowIso),
  };
}
