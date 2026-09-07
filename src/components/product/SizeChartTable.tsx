/**
 * Shared size-chart renderer used by the size-guide page and the product
 * dialog. Renders a semantic table on wide screens and stacked definition
 * cards on narrow ones (no clipped columns, no horizontal page overflow),
 * and works unchanged in RTL because it relies on logical properties.
 *
 * Values arrive in metric and are converted for display only.
 */
import { useI18n } from "../../lib/i18n/index.tsx";
import type { SizeChart } from "../../services/types.ts";
import { formatRange, unitLabel, type UnitSystem } from "../../services/sizing.ts";
import { useL } from "../ui/bits.tsx";

export function SizeChartTable({
  chart,
  system,
  /** Sizes the product offers that the supplier has not measured yet. */
  unconfirmedSizes = [],
}: {
  chart: SizeChart;
  system: UnitSystem;
  unconfirmedSizes?: string[];
}) {
  const { t } = useI18n();
  const L = useL();
  const header = (key: string, unit: (typeof chart.columns)[number]["unit"]) => {
    const u = unitLabel(unit, system);
    return u ? `${t(key)} (${u})` : t(key);
  };

  return (
    <div className="size-chart">
      {chart.confirmation === "preliminary" && (
        <p className="badge badge--warn size-chart__notice" role="note">
          {t("sizeGuide.preliminaryNote")}
        </p>
      )}

      {/* Wide screens: comparable table */}
      <div className="table-wrap size-chart__table" tabIndex={0} role="region" aria-label={L(chart.name)}>
        <table className="table">
          <caption className="sr-only">{L(chart.name)}</caption>
          <thead>
            <tr>
              <th scope="col">{t("product.size")}</th>
              {chart.columns.map((col) => (
                <th key={col.key} scope="col">
                  {header(col.labelKey, col.unit)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => (
              <tr key={row.size}>
                <th scope="row" className="size-chart__size">
                  {row.size}
                </th>
                {chart.columns.map((col) => (
                  <td key={col.key} className="num">
                    {/* Isolated LTR so ranges read "69–71" in RTL too. */}
                    <bdi dir="ltr">{formatRange(row.values[col.key], col.unit, system)}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: stacked cards, nothing clipped */}
      <ul className="size-chart__cards">
        {chart.rows.map((row) => (
          <li key={row.size} className="size-chart__card">
            <p className="size-chart__card-size">{row.size}</p>
            <dl>
              {chart.columns.map((col) => (
                <div key={col.key} className="size-chart__pair">
                  <dt>{header(col.labelKey, col.unit)}</dt>
                  <dd className="num">
                    <bdi dir="ltr">{formatRange(row.values[col.key], col.unit, system)}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {unconfirmedSizes.length > 0 && (
        <p className="size-chart__unconfirmed" role="note">
          {t("sizeGuide.sizeNotMeasured", { sizes: unconfirmedSizes.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Measuring instructions — identical wording everywhere the chart appears. */
export function SizeMeasuringHelp() {
  const { t } = useI18n();
  return (
    <div className="stack--sm stack size-chart__help">
      <h3 className="field__label">{t("sizeGuide.howToMeasure")}</h3>
      <ol className="size-chart__steps">
        <li>{t("sizeGuide.step1")}</li>
        <li>{t("sizeGuide.step2")}</li>
        <li>{t("sizeGuide.step3")}</li>
        <li>{t("sizeGuide.step4")}</li>
      </ol>
      <p className="text-sm text-muted">{t("sizeGuide.variesNote")}</p>
    </div>
  );
}

/** Metric / imperial switch. */
export function UnitToggle({ system, onChange }: { system: UnitSystem; onChange: (s: UnitSystem) => void }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ gap: "var(--sp-2)" }} role="group" aria-label={t("sizeGuide.units")}>
      <button type="button" className={`chip${system === "metric" ? " is-selected" : ""}`} aria-pressed={system === "metric"} onClick={() => onChange("metric")}>
        {t("sizeGuide.cm")}
      </button>
      <button type="button" className={`chip${system === "imperial" ? " is-selected" : ""}`} aria-pressed={system === "imperial"} onClick={() => onChange("imperial")}>
        {t("sizeGuide.inches")}
      </button>
    </div>
  );
}
