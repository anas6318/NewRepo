import { useEffect, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useSettings } from "../../services/store.tsx";
import { isDemoMode } from "../../services/index.ts";
import { initAnalytics, track } from "../../lib/analytics.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";
import { useL } from "../ui/bits.tsx";
import { Header } from "./Header.tsx";
import { Footer } from "./Footer.tsx";
import { CartDrawer } from "./CartDrawer.tsx";
import { IconWhatsApp } from "../ui/Icons.tsx";

export function StorefrontLayout({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <a href="#main" className="skip-link">
        {t("nav.skipToContent")}
      </a>

      {isDemoMode() && (
        <p className="demo-banner" role="note">
          {t("common.demoBanner")}
        </p>
      )}

      {settings && L(settings.announcement) && (
        <p className="announce-bar">
          <span className="gold">★ </span>
          {L(settings.announcement)}
        </p>
      )}

      <Header />
      {children}
      <Footer />
      <CartDrawer />

      {settings?.whatsappNumber && (
        <a
          className="wa-float"
          href={whatsappLink(settings.whatsappNumber, locale, { intent: "general" })}
          target="_blank"
          rel="noreferrer"
          aria-label={t("whatsapp.floatingLabel")}
          onClick={() => track("whatsapp_click", { placement: "float" })}
        >
          <IconWhatsApp size={26} />
        </a>
      )}
    </>
  );
}
