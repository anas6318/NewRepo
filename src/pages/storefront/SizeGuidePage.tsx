import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";
import type { SizeChart } from "../../services/types.ts";
import { useL } from "../../components/ui/bits.tsx";
import { IconWhatsApp } from "../../components/ui/Icons.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";

export function SizeGuidePage() {
  const { locale, t } = useI18n();
  const L = useL();
  const { settings } = useSettings();
  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [activeId, setActiveId] = useState("fan");
  const [inches, setInches] = useState(false);

  usePageMeta({ title: t("sizeGuide.title"), description: t("sizeGuide.intro"), path: "/size-guide", locale });

  useEffect(() => {
    track("size_guide_view", { chart: "page" });
    dataService()
      .listSizeCharts()
      .then(setCharts)
      .catch(() => undefined);
  }, []);

  const active = charts.find((c) => c.id === activeId) ?? charts[0];
  const cm = (v: number) => (inches ? (v / 2.54).toFixed(1) : v);

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={[{ label: t("sizeGuide.title"), path: "/size-guide" }]} />
      <h1 className="section__title mb-4">{t("sizeGuide.title")}</h1>
      <p className="text-muted mb-6" style={{ maxWidth: "62ch" }}>
        {t("sizeGuide.intro")}
      </p>

      <div className="tabs mb-6" role="tablist" aria-label={t("sizeGuide.title")}>
        {charts.map((chart) => (
          <button key={chart.id} type="button" role="tab" aria-selected={chart.id === (active?.id ?? "")} onClick={() => setActiveId(chart.id)}>
            {L(chart.name)}
          </button>
        ))}
      </div>

      {active && (
        <div className="stack" style={{ maxWidth: 620 }}>
          {active.isPlaceholder && <p className="badge badge--warn">{t("sizeGuide.placeholderNote")}</p>}
          <div className="row" style={{ gap: "var(--sp-2)" }}>
            <button type="button" className={`chip${!inches ? " is-selected" : ""}`} aria-pressed={!inches} onClick={() => setInches(false)}>
              {t("sizeGuide.cm")}
            </button>
            <button type="button" className={`chip${inches ? " is-selected" : ""}`} aria-pressed={inches} onClick={() => setInches(true)}>
              {t("sizeGuide.inches")}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 0 }}>
              <caption className="sr-only">{L(active.name)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("product.size")}</th>
                  <th scope="col">{t("sizeGuide.chest")}</th>
                  <th scope="col">{t("sizeGuide.length")}</th>
                </tr>
              </thead>
              <tbody>
                {active.rows.map((row) => (
                  <tr key={row.size}>
                    <td style={{ fontWeight: 700 }}>{row.size}</td>
                    <td className="num">{cm(row.chestCm)}</td>
                    <td className="num">{cm(row.lengthCm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">{L(active.note)}</p>
          <p className="text-sm text-muted">{t("sizeGuide.variesNote")}</p>
          {settings?.whatsappNumber && (
            <a
              className="btn btn--outline"
              style={{ alignSelf: "flex-start" }}
              href={whatsappLink(settings.whatsappNumber, locale, { intent: "size-help" })}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("whatsapp_click", { placement: "size_guide" })}
            >
              <IconWhatsApp size={16} /> {t("product.needHelpSizing")}
            </a>
          )}
        </div>
      )}
    </main>
  );
}
