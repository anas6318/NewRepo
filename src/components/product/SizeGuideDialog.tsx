import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { dataService } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import type { SizeChart } from "../../services/types.ts";
import { useL } from "../ui/bits.tsx";
import { IconClose, IconRuler } from "../ui/Icons.tsx";

export function SizeGuideDialog({ chartId, trigger }: { chartId: string; trigger?: string }) {
  const { t } = useI18n();
  const L = useL();
  const [open, setOpen] = useState(false);
  const [chart, setChart] = useState<SizeChart | null>(null);
  const [inches, setInches] = useState(false);
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

  const cm = (v: number) => (inches ? (v / 2.54).toFixed(1) : v);

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
            {chart?.isPlaceholder && <p className="badge badge--warn mb-4">{t("sizeGuide.placeholderNote")}</p>}
            <div className="row mb-4" style={{ gap: "var(--sp-2)" }}>
              <button type="button" className={`chip${!inches ? " is-selected" : ""}`} aria-pressed={!inches} onClick={() => setInches(false)}>
                {t("sizeGuide.cm")}
              </button>
              <button type="button" className={`chip${inches ? " is-selected" : ""}`} aria-pressed={inches} onClick={() => setInches(true)}>
                {t("sizeGuide.inches")}
              </button>
            </div>
            {chart && (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 0 }}>
                  <caption className="sr-only">{L(chart.name)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("product.size")}</th>
                      <th scope="col">{t("sizeGuide.chest")}</th>
                      <th scope="col">{t("sizeGuide.length")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.rows.map((row) => (
                      <tr key={row.size}>
                        <td className="num" style={{ fontWeight: 700 }}>{row.size}</td>
                        <td className="num">{cm(row.chestCm)}</td>
                        <td className="num">{cm(row.lengthCm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {chart && <p className="text-xs text-muted mt-4">{L(chart.note)}</p>}
          </div>
        </div>
      )}
    </>
  );
}
