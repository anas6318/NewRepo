import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { dataService } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import type { SizeChart } from "../../services/types.ts";
import type { UnitSystem } from "../../services/sizing.ts";
import { useL } from "../ui/bits.tsx";
import { IconClose, IconRuler } from "../ui/Icons.tsx";
import { SizeChartTable, SizeMeasuringHelp, UnitToggle } from "./SizeChartTable.tsx";

export function SizeGuideDialog({
  chartId,
  trigger,
  /** Sizes this product offers that the supplier has not measured yet. */
  unconfirmedSizes = [],
}: {
  chartId: string;
  trigger?: string;
  unconfirmedSizes?: string[];
}) {
  const { t } = useI18n();
  const L = useL();
  const [open, setOpen] = useState(false);
  const [chart, setChart] = useState<SizeChart | null>(null);
  const [system, setSystem] = useState<UnitSystem>("metric");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    track("size_guide_view", { chart: chartId });
    dataService()
      .listSizeCharts()
      .then((charts) => setChart(charts.find((c) => c.id === chartId) ?? charts[0] ?? null))
      .catch(() => undefined);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, chartId]);

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
        <IconRuler size={16} /> {trigger ?? t("product.sizeGuideLink")}
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sg-title">
            <div className="row row--between mb-4">
              <h2 id="sg-title" className="drawer__title">
                {t("sizeGuide.title")} — {chart ? L(chart.name) : ""}
              </h2>
              <button ref={closeRef} type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setOpen(false)}>
                <IconClose />
              </button>
            </div>
            <div className="stack">
              <UnitToggle system={system} onChange={setSystem} />
              {chart && <SizeChartTable chart={chart} system={system} unconfirmedSizes={unconfirmedSizes} />}
              {chart && <p className="text-xs text-muted">{L(chart.note)}</p>}
              <SizeMeasuringHelp />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
