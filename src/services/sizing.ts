/**
 * Sizing + supplier-availability domain module.
 *
 * Single source of truth for:
 *  - supplier-confirmed size charts (fan / player / kids / training suit)
 *  - which sizes each product type may offer
 *  - resolving availability at product → version → size level
 *  - metric → imperial display conversion
 *
 * MEASUREMENT SEMANTICS (important):
 *  `widthFlatCm` is the garment width measured with the jersey laid flat,
 *  armpit to armpit. It is NOT a chest circumference and must never be
 *  labelled as one. The training-suit chart is the exception: the supplier
 *  supplies a bust/chest value there, kept as `bustCm` and labelled as
 *  supplied.
 *
 * The charts below are the values confirmed by the supplier. Nothing is
 * interpolated or invented — where the supplier has not confirmed a size
 * (e.g. Fan 4XL) there is deliberately no row, and the UI shows a
 * confirmation notice instead of a fabricated measurement.
 */
import type {
  AvailabilityRecord,
  AvailabilityState,
  JerseyVersion,
  LocalizedText,
  Product,
  SizeChart,
  SizeChartColumn,
  SizeChartRow,
} from "./types.ts";

export type { AvailabilityRecord, AvailabilityState } from "./types.ts";

/* ── Product sizing types ──────────────────────────────────────────────── */

/** Chart/size-rule families. Mirrors size_charts.id values. */
export type SizeChartId = "fan" | "player" | "kids" | "training-suit" | "retro" | "long-sleeve" | "hoodie";

export const CONFIRMED_CHART_IDS: SizeChartId[] = ["fan", "player", "kids", "training-suit"];
/** Charts the supplier has NOT confirmed — shown with a preliminary notice. */
export const PRELIMINARY_CHART_IDS: SizeChartId[] = ["retro", "long-sleeve", "hoodie"];

/** Public size labels. Supplier aliases (P/G/GG/XG/2XG) are never displayed. */
export const FAN_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
/** Fan sizes with confirmed measurements — 4XL is opt-in per product. */
export const FAN_DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
export const PLAYER_SIZES = ["S", "M", "L", "XL", "2XL"];
export const TRAINING_SUIT_SIZES = ["S", "M", "L", "XL", "2XL"];
export const KIDS_SIZES = ["16", "18", "20", "22", "24", "26", "28"];
/** Legacy adult set kept for product types with no confirmed chart. */
export const LEGACY_ADULT_SIZES = ["S", "M", "L", "XL", "2XL"];

/** Sizes offered for a product type, and which of them are opt-in per product. */
export const SIZE_RULES: Record<SizeChartId, { allowed: string[]; default: string[]; optIn: string[] }> = {
  fan: { allowed: FAN_SIZES, default: FAN_DEFAULT_SIZES, optIn: ["4XL"] },
  player: { allowed: PLAYER_SIZES, default: PLAYER_SIZES, optIn: [] },
  "training-suit": { allowed: TRAINING_SUIT_SIZES, default: TRAINING_SUIT_SIZES, optIn: [] },
  kids: { allowed: KIDS_SIZES, default: KIDS_SIZES, optIn: [] },
  // Unconfirmed types keep their existing product-specific options.
  retro: { allowed: LEGACY_ADULT_SIZES, default: LEGACY_ADULT_SIZES, optIn: [] },
  "long-sleeve": { allowed: LEGACY_ADULT_SIZES, default: LEGACY_ADULT_SIZES, optIn: [] },
  hoodie: { allowed: LEGACY_ADULT_SIZES, default: LEGACY_ADULT_SIZES, optIn: [] },
};

/** Which chart applies to a product (+ selected version). */
export function chartIdFor(product: Pick<Product, "kids" | "categorySlug" | "tags">, version?: JerseyVersion): SizeChartId {
  if (product.kids || version === "kids") return "kids";
  if (product.tags?.includes("training-suit") || product.categorySlug === "training-suits") return "training-suit";
  if (product.categorySlug === "hoodies") return "hoodie";
  if (product.categorySlug === "long-sleeve") return "long-sleeve";
  if (version === "player") return "player";
  if (version === "fan") return "fan";
  if (version === "retro") return "retro";
  if (product.categorySlug === "player-version") return "player";
  if (product.categorySlug === "retro") return "retro";
  return "fan";
}

/** Validates a size list against a product type. Used by supplier import. */
export function validateSizes(chartId: SizeChartId, sizes: string[]): { valid: string[]; invalid: string[] } {
  const allowed = SIZE_RULES[chartId].allowed;
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of sizes) {
    const size = normalizeSizeLabel(raw);
    if (allowed.includes(size)) valid.push(size);
    else invalid.push(raw);
  }
  return { valid, invalid };
}

/** Maps supplier aliases onto the public label set. */
const SIZE_ALIASES: Record<string, string> = {
  P: "S",
  G: "L",
  GG: "2XL",
  XG: "XL",
  "2XG": "2XL",
  "3XG": "3XL",
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
};

export function normalizeSizeLabel(raw: string): string {
  const s = raw.trim().toUpperCase();
  return SIZE_ALIASES[s] ?? s;
}

/* ── Availability ──────────────────────────────────────────────────────── */

/** Key used in Product.sizeAvailability: `${version|*}:${size}`. */
export function sizeKey(version: JerseyVersion | undefined, size: string): string {
  return `${version ?? "*"}:${size}`;
}

/** A supplier confirmation is only trusted for this long. */
export const AVAILABILITY_FRESH_DAYS = 7;
const FRESH_MS = AVAILABILITY_FRESH_DAYS * 24 * 60 * 60 * 1000;

export type ConfirmationFreshness = "confirmed" | "expired" | "unconfirmed";

export interface ResolvedAvailability {
  status: AvailabilityState;
  /** Which level decided the outcome — useful for admin display. */
  source: "size" | "version" | "product" | "derived";
  lastCheckedAt?: string;
  /** True when a stored `available` was set aside because the check aged out. */
  stale: boolean;
  /** True when the size has no supplier-confirmed measurements (e.g. Fan 4XL). */
  measurementsUnconfirmed: boolean;
}

/**
 * Classifies an owner's confirmation. `unavailable` and `discontinued` are
 * decisions, not perishable claims — they never expire into availability.
 * Only `available` has a shelf life.
 */
export function confirmationFreshness(record: AvailabilityRecord | undefined, now: number = Date.now()): ConfirmationFreshness {
  if (!record || record.status !== "available") return "unconfirmed";
  if (!record.lastCheckedAt) return "unconfirmed";
  const checked = Date.parse(record.lastCheckedAt);
  if (Number.isNaN(checked)) return "unconfirmed";
  return now - checked <= FRESH_MS ? "confirmed" : "expired";
}

/** Milliseconds until an `available` record goes stale (negative once expired). */
export function confirmationExpiresAt(record: AvailabilityRecord | undefined): string | undefined {
  if (!record?.lastCheckedAt) return undefined;
  const checked = Date.parse(record.lastCheckedAt);
  return Number.isNaN(checked) ? undefined : new Date(checked + FRESH_MS).toISOString();
}

/**
 * `available` is a claim that a human checked with the supplier, so it only
 * counts when it carries the date of that check AND that check is still
 * within the freshness window. An undated or aged-out record is treated as
 * unconfirmed — the stored decision itself is never modified here.
 */
export function effectiveStatus(record: AvailabilityRecord | undefined, now: number = Date.now()): AvailabilityState | undefined {
  if (!record) return undefined;
  if (record.status !== "available") return record.status; // decisions do not expire
  return confirmationFreshness(record, now) === "confirmed" ? "available" : "confirmation_required";
}

/**
 * Resolves availability for a product / version / size.
 *
 * Two rules drive this:
 *
 *  1. Publication status is NOT availability. The catalog is built from the
 *     supplier's Yupoo album, which shows that a design is generally offered
 *     — never that a given version and size can be produced today. Anything
 *     without an explicit, dated confirmation resolves to
 *     `confirmation_required`, whether it is published or not.
 *
 *  2. A broader `available` never overrides a narrower restriction. The most
 *     specific record wins for positive states, but `unavailable` /
 *     `discontinued` anywhere in the chain wins outright.
 */
export function resolveAvailability(
  product: Pick<Product, "status" | "kids" | "categorySlug" | "tags" | "availability" | "versionAvailability" | "sizeAvailability">,
  version: JerseyVersion | undefined,
  size: string | undefined,
  now: number = Date.now(),
): ResolvedAvailability {
  const measurementsUnconfirmed = size ? !hasConfirmedRow(chartIdFor(product, version), size) : false;

  // Most specific first.
  const chain: { record: AvailabilityRecord | undefined; source: ResolvedAvailability["source"] }[] = [
    { record: size ? (product.sizeAvailability?.[sizeKey(version, size)] ?? product.sizeAvailability?.[sizeKey(undefined, size)]) : undefined, source: "size" },
    { record: version ? product.versionAvailability?.[version] : undefined, source: "version" },
    { record: product.availability, source: "product" },
  ];

  // Restrictive states win from any level — a product marked available can
  // never re-enable a size or version the supplier said no to. These are
  // decisions rather than perishable claims, so freshness never touches them.
  for (const state of ["discontinued", "unavailable"] as const) {
    const hit = chain.find((c) => effectiveStatus(c.record, now) === state);
    if (hit) return { status: state, source: hit.source, lastCheckedAt: hit.record?.lastCheckedAt, stale: false, measurementsUnconfirmed };
  }
  if (product.status === "archived") return { status: "discontinued", source: "derived", stale: false, measurementsUnconfirmed };
  if (product.status === "unavailable") return { status: "unavailable", source: "derived", stale: false, measurementsUnconfirmed };

  const decided = chain.find((c) => c.record !== undefined);
  if (decided) {
    // An `available` record that aged out is reported as stale: the stored
    // decision stays exactly as the owner left it, but it no longer confirms.
    const stale = confirmationFreshness(decided.record, now) === "expired";
    return {
      status: effectiveStatus(decided.record, now)!,
      source: decided.source,
      lastCheckedAt: decided.record?.lastCheckedAt,
      stale,
      measurementsUnconfirmed,
    };
  }

  // No confirmation on record anywhere: catalog presence only.
  return { status: "confirmation_required", source: "derived", stale: false, measurementsUnconfirmed };
}

/** Sizes a customer may pick, with each one's resolved state. */
export function sizeOptionsFor(
  product: Pick<Product, "sizes" | "status" | "kids" | "categorySlug" | "tags" | "availability" | "versionAvailability" | "sizeAvailability" | "versionSizes">,
  version: JerseyVersion | undefined,
  now: number = Date.now(),
): { size: string; availability: ResolvedAvailability }[] {
  const override = version ? product.versionSizes?.[version] : undefined;
  const list = override?.length ? override : product.sizes;
  return list.map((size) => ({ size, availability: resolveAvailability(product, version, size, now) }));
}

/**
 * Strips internal supplier data from a product before it reaches a customer:
 * supplier identity, reference, cost, and the internal notes attached to any
 * availability record. The availability *states* stay — only the private
 * annotations are removed.
 */
export function toPublicProduct<T extends Product>(product: T): T {
  const strip = (r?: AvailabilityRecord): AvailabilityRecord | undefined =>
    r ? { status: r.status, ...(r.lastCheckedAt ? { lastCheckedAt: r.lastCheckedAt } : {}) } : undefined;

  const clone: T = { ...product };
  delete clone.supplier;
  if (clone.availability) clone.availability = strip(clone.availability);
  if (clone.versionAvailability) {
    clone.versionAvailability = Object.fromEntries(
      Object.entries(clone.versionAvailability).map(([k, v]) => [k, strip(v)]),
    ) as Product["versionAvailability"];
  }
  if (clone.sizeAvailability) {
    clone.sizeAvailability = Object.fromEntries(
      Object.entries(clone.sizeAvailability).map(([k, v]) => [k, strip(v)!]),
    );
  }
  return clone;
}

/** True when the item can be added to cart at all. */
export function isOrderable(state: AvailabilityState): boolean {
  return state === "available" || state === "confirmation_required";
}

/** True when the order must wait for a supplier check before production. */
export function requiresSupplierConfirmation(state: AvailabilityState): boolean {
  return state === "confirmation_required";
}

/* ── Confirmed supplier charts ─────────────────────────────────────────── */

const R = (min: number, max?: number) => ({ min, ...(max !== undefined && max !== min ? { max } : {}) });

function L(ar: string, he: string, en: string): LocalizedText {
  return { ar, he, en };
}

const CONFIRMED_NOTE = L(
  "قياسات مؤكدة من المورد للقميص نفسه. العرض يُقاس والقميص مسطّح من إبط إلى إبط، وليس محيط الصدر.",
  "מידות שאושרו מול הספק ומתייחסות לחולצה עצמה. הרוחב נמדד כשהחולצה מונחת שטוח, מבית שחי לבית שחי — ולא היקף חזה.",
  "Supplier-confirmed garment measurements. Width is measured with the jersey laid flat, armpit to armpit — it is not a chest circumference.",
);

const KIDS_NOTE = L(
  "قياسات مؤكدة من المورد للطقم. العمر الموصى به إرشادي فقط — قارن قياسات القطعة أولًا.",
  "מידות שאושרו מול הספק עבור הסט. הגיל המומלץ הוא הכוונה בלבד — השוו קודם את מידות הפריט.",
  "Supplier-confirmed measurements for the kit. Recommended age is guidance only — compare the garment measurements first.",
);

const TRAINING_NOTE = L(
  "قياسات مؤكدة من المورد لبدلة التدريب. قيمة الصدر مُعطاة من المورد كمحيط صدر وليست عرضًا مسطحًا.",
  "מידות שאושרו מול הספק לחליפת האימון. ערך החזה נמסר על ידי הספק כהיקף חזה ואינו רוחב שטוח.",
  "Supplier-confirmed measurements for the training suit. The bust value is supplied by the supplier as a chest measurement, not a flat width.",
);

const JERSEY_COLUMNS: SizeChartColumn[] = [
  { key: "lengthCm", labelKey: "sizeGuide.colJerseyLength", unit: "cm" },
  { key: "widthFlatCm", labelKey: "sizeGuide.colWidthFlat", unit: "cm" },
  { key: "heightCm", labelKey: "sizeGuide.colHeight", unit: "cm" },
  { key: "weightKg", labelKey: "sizeGuide.colWeight", unit: "kg" },
];

const KIDS_COLUMNS: SizeChartColumn[] = [
  { key: "lengthCm", labelKey: "sizeGuide.colShirtLength", unit: "cm" },
  { key: "halfChestCm", labelKey: "sizeGuide.colHalfChest", unit: "cm" },
  { key: "shortsLengthCm", labelKey: "sizeGuide.colShortsLength", unit: "cm" },
  { key: "waistCm", labelKey: "sizeGuide.colWaist", unit: "cm" },
  { key: "heightCm", labelKey: "sizeGuide.colHeight", unit: "cm" },
  { key: "age", labelKey: "sizeGuide.colAge", unit: "age" },
];

const TRAINING_COLUMNS: SizeChartColumn[] = [
  { key: "lengthCm", labelKey: "sizeGuide.colGarmentLength", unit: "cm" },
  { key: "bustCm", labelKey: "sizeGuide.colBust", unit: "cm" },
  { key: "heightCm", labelKey: "sizeGuide.colHeight", unit: "cm" },
  { key: "weightKg", labelKey: "sizeGuide.colWeight", unit: "kg" },
];

/** Fan version — men. Supplier-confirmed through 3XL only. */
export const FAN_CHART_ROWS: SizeChartRow[] = [
  { size: "S", values: { lengthCm: R(69, 71), widthFlatCm: R(53, 55), heightCm: R(162, 170), weightKg: R(50, 62) } },
  { size: "M", values: { lengthCm: R(71, 73), widthFlatCm: R(55, 57), heightCm: R(170, 176), weightKg: R(62, 78) } },
  { size: "L", values: { lengthCm: R(73, 75), widthFlatCm: R(57, 58), heightCm: R(176, 182), weightKg: R(78, 83) } },
  { size: "XL", values: { lengthCm: R(75, 78), widthFlatCm: R(58, 60), heightCm: R(182, 190), weightKg: R(83, 90) } },
  { size: "2XL", values: { lengthCm: R(78, 81), widthFlatCm: R(60, 62), heightCm: R(190, 195), weightKg: R(90, 97) } },
  { size: "3XL", values: { lengthCm: R(81, 83), widthFlatCm: R(62, 64), heightCm: R(192, 197), weightKg: R(97, 104) } },
  // 4XL intentionally absent — the supplier has not confirmed measurements.
];

/** Player version — men. Slimmer athletic cut. */
export const PLAYER_CHART_ROWS: SizeChartRow[] = [
  { size: "S", values: { lengthCm: R(69), widthFlatCm: R(49, 51), heightCm: R(162, 170), weightKg: R(50, 62) } },
  { size: "M", values: { lengthCm: R(69, 71), widthFlatCm: R(51, 53), heightCm: R(170, 176), weightKg: R(62, 78) } },
  { size: "L", values: { lengthCm: R(71, 73), widthFlatCm: R(53, 55), heightCm: R(176, 182), weightKg: R(78, 83) } },
  { size: "XL", values: { lengthCm: R(73, 75), widthFlatCm: R(55, 57), heightCm: R(182, 190), weightKg: R(83, 90) } },
  { size: "2XL", values: { lengthCm: R(75, 77), widthFlatCm: R(57, 59), heightCm: R(190, 195), weightKg: R(90, 97) } },
];

/** Kids jersey kit (shirt + shorts). */
export const KIDS_CHART_ROWS: SizeChartRow[] = [
  { size: "16", values: { lengthCm: R(43), halfChestCm: R(32), shortsLengthCm: R(32), waistCm: R(20, 37), heightCm: R(95, 105), age: R(2, 3) } },
  { size: "18", values: { lengthCm: R(47), halfChestCm: R(34), shortsLengthCm: R(34), waistCm: R(21, 39), heightCm: R(105, 115), age: R(3, 4) } },
  { size: "20", values: { lengthCm: R(50), halfChestCm: R(36), shortsLengthCm: R(36), waistCm: R(22, 41), heightCm: R(115, 125), age: R(4, 5) } },
  { size: "22", values: { lengthCm: R(53), halfChestCm: R(38), shortsLengthCm: R(38), waistCm: R(23, 42), heightCm: R(125, 135), age: R(6, 7) } },
  { size: "24", values: { lengthCm: R(56), halfChestCm: R(40), shortsLengthCm: R(39), waistCm: R(24, 44), heightCm: R(135, 145), age: R(8, 9) } },
  { size: "26", values: { lengthCm: R(58), halfChestCm: R(42), shortsLengthCm: R(40), waistCm: R(25, 47), heightCm: R(145, 155), age: R(10, 11) } },
  { size: "28", values: { lengthCm: R(61), halfChestCm: R(44), shortsLengthCm: R(43), waistCm: R(26, 50), heightCm: R(155, 165), age: R(11, 12) } },
];

/** Long-sleeved training suit / tracksuit. Bust is supplied as a chest value. */
export const TRAINING_SUIT_CHART_ROWS: SizeChartRow[] = [
  { size: "S", values: { lengthCm: R(69), bustCm: R(100), heightCm: R(155, 170), weightKg: R(55, 65) } },
  { size: "M", values: { lengthCm: R(71), bustCm: R(104), heightCm: R(165, 175), weightKg: R(60, 75) } },
  { size: "L", values: { lengthCm: R(73), bustCm: R(108), heightCm: R(170, 185), weightKg: R(70, 85) } },
  { size: "XL", values: { lengthCm: R(75), bustCm: R(112), heightCm: R(180, 195), weightKg: R(80, 100) } },
  { size: "2XL", values: { lengthCm: R(77), bustCm: R(116), heightCm: R(195, 210), weightKg: R(95, 115) } },
];

/** The four supplier-confirmed charts, ready to persist or serve. */
export const CONFIRMED_SIZE_CHARTS: SizeChart[] = [
  {
    id: "fan",
    name: L("نسخة المشجع", "גרסת אוהד", "Fan version"),
    note: CONFIRMED_NOTE,
    columns: JERSEY_COLUMNS,
    rows: FAN_CHART_ROWS,
    confirmation: "supplier_confirmed",
    isPlaceholder: false,
  },
  {
    id: "player",
    name: L("نسخة اللاعب (قصّة ضيقة)", "גרסת שחקן (גזרה צמודה)", "Player version (athletic cut)"),
    note: CONFIRMED_NOTE,
    columns: JERSEY_COLUMNS,
    rows: PLAYER_CHART_ROWS,
    confirmation: "supplier_confirmed",
    isPlaceholder: false,
  },
  {
    id: "kids",
    name: L("طقم أطفال", "סט ילדים", "Kids kit"),
    note: KIDS_NOTE,
    columns: KIDS_COLUMNS,
    rows: KIDS_CHART_ROWS,
    confirmation: "supplier_confirmed",
    isPlaceholder: false,
  },
  {
    id: "training-suit",
    name: L("بدلة تدريب", "חליפת אימון", "Training suit"),
    note: TRAINING_NOTE,
    columns: TRAINING_COLUMNS,
    rows: TRAINING_SUIT_CHART_ROWS,
    confirmation: "supplier_confirmed",
    isPlaceholder: false,
  },
];

/** True when a chart has a supplier-confirmed row for that size. */
export function hasConfirmedRow(chartId: SizeChartId, size: string): boolean {
  const chart = CONFIRMED_SIZE_CHARTS.find((c) => c.id === chartId);
  if (!chart) return false; // preliminary charts confirm nothing
  return chart.rows.some((r) => r.size === size);
}

/* ── Legacy chart normalisation ────────────────────────────────────────── */

/**
 * Upgrades a stored chart to the current shape. Rows persisted before this
 * release carry flat `chestCm` / `lengthCm` numbers and no `columns`; they
 * keep working and are explicitly marked preliminary rather than silently
 * presented as confirmed.
 */
export function normalizeChart(raw: SizeChart): SizeChart {
  if (raw.columns?.length && raw.rows.every((r) => r.values)) {
    return { ...raw, confirmation: raw.confirmation ?? (raw.isPlaceholder ? "preliminary" : "supplier_confirmed") };
  }
  const rows: SizeChartRow[] = raw.rows.map((r) => ({
    size: r.size,
    values: r.values ?? {
      ...(r.lengthCm !== undefined ? { lengthCm: R(r.lengthCm) } : {}),
      ...(r.chestCm !== undefined ? { legacyChestCm: R(r.chestCm) } : {}),
    },
    ...(r.lengthCm !== undefined ? { lengthCm: r.lengthCm } : {}),
    ...(r.chestCm !== undefined ? { chestCm: r.chestCm } : {}),
  }));
  return {
    ...raw,
    columns: [
      { key: "lengthCm", labelKey: "sizeGuide.colJerseyLength", unit: "cm" },
      { key: "legacyChestCm", labelKey: "sizeGuide.colLegacyChest", unit: "cm" },
    ],
    rows,
    confirmation: "preliminary",
    isPlaceholder: true,
  };
}

/* ── Unit conversion (display layer only) ──────────────────────────────── */

export type UnitSystem = "metric" | "imperial";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Converts a stored metric value for display. Age is never converted. */
export function convertValue(value: number, unit: SizeChartColumn["unit"], system: UnitSystem): number {
  if (system === "metric" || unit === "age") return value;
  if (unit === "cm") return round1(value / 2.54);
  if (unit === "kg") return round1(value * 2.2046226218);
  return value;
}

/** Formats a stored range for display, preserving the range shape. */
export function formatRange(
  range: { min: number; max?: number } | undefined,
  unit: SizeChartColumn["unit"],
  system: UnitSystem,
): string {
  if (!range) return "—";
  const min = convertValue(range.min, unit, system);
  if (range.max === undefined) return String(min);
  const max = convertValue(range.max, unit, system);
  return `${min}–${max}`;
}

/** Suffix shown in the column header. Age carries no unit. */
export function unitLabel(unit: SizeChartColumn["unit"], system: UnitSystem): string {
  if (unit === "age") return "";
  if (unit === "cm") return system === "metric" ? "cm" : "in";
  return system === "metric" ? "kg" : "lb";
}
