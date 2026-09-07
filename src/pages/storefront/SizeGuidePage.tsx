import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";
import type { SizeChart } from "../../services/types.ts";
import { SIZE_RULES, type SizeChartId, type UnitSystem } from "../../services/sizing.ts";
import { useL } from "../../components/ui/bits.tsx";
import { IconWhatsApp } from "../../components/ui/Icons.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { SizeChartTable, SizeMeasuringHelp, UnitToggle } from "../../components/product/SizeChartTable.tsx";

/** Sizes a type offers that the supplier has not measured (e.g. Fan 4XL). */
function unmeasuredSizes(chart: SizeChart): string[] {
  const rules = SIZE_RULES[chart.id as SizeChartId];
  if (!rules) return [];
  return rules.allowed.filter((s) => !chart.rows.some((r) => r.size === s));
}

export function SizeGuidePage() {
  const { locale, t } = useI18n();
  const L = useL();
  const { settings } = useSettings();
  const [charts, setCharts] = useState<SizeChart[]>([]);
  const [activeId, setActiveId] = useState("fan");
  const [system, setSystem] = useState<UnitSystem>("metric");

  usePageMeta({ title: t("sizeGuide.title"), description: t("sizeGuide.intro"), path: "/size-guide", locale });

  useEffect(() => {
    track("size_guide_view", { chart: "page" });
    dataService()
      .listSizeCharts()
      .then(setCharts)
      .catch(() => undefined);
  }, []);

  const active = charts.find((c) => c.id === activeId) ?? charts[0];

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs items={[{ label: t("sizeGuide.title"), path: "/size-guide" }]} />
      <h1 className="section__title mb-4">{t("sizeGuide.title")}</h1>
      <p className="text-muted mb-6" style={{ maxWidth: "62ch" }}>
        {t("sizeGuide.intro")}
      </p>

      <div className="tabs mb-6" role="tablist" aria-label={t("sizeGuide.title")}>
        {charts.map((chart) => (
          <button
            key={chart.id}
            type="button"
            role="tab"
            id={`sg-tab-${chart.id}`}
            aria-selected={chart.id === (active?.id ?? "")}
            aria-controls={`sg-panel-${chart.id}`}
            onClick={() => setActiveId(chart.id)}
          >
            {L(chart.name)}
          </button>
        ))}
      </div>

      {active && (
        <div className="stack stack--lg" id={`sg-panel-${active.id}`} role="tabpanel" aria-labelledby={`sg-tab-${active.id}`}>
          <UnitToggle system={system} onChange={setSystem} />
          <SizeChartTable chart={active} system={system} unconfirmedSizes={unmeasuredSizes(active)} />
          <p className="text-sm text-muted" style={{ maxWidth: "70ch" }}>
            {L(active.note)}
          </p>
          <SizeMeasuringHelp />
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
