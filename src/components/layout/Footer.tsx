import { useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useSettings, useToast } from "../../services/store.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import { useL } from "../ui/bits.tsx";
import { IconInstagram, IconWhatsApp } from "../ui/Icons.tsx";
import { whatsappLink } from "../../lib/whatsapp.ts";

export function Footer() {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();
  const P = `/${locale}`;

  const shopLinks = [
    { key: "retro", path: "/category/retro" },
    { key: "currentSeason", path: "/category/current-season" },
    { key: "nationalTeams", path: "/category/national-teams" },
    { key: "hoodies", path: "/category/hoodies" },
    { key: "kids", path: "/category/kids" },
  ];
  const helpLinks = [
    { key: "sizeGuide", path: "/size-guide" },
    { key: "trackOrder", path: "/track" },
    { label: t("footer.howOrdering"), path: "/how-it-works" },
    { label: t("footer.delivery"), path: "/delivery" },
    { label: t("footer.faq"), path: "/faq" },
    { key: "contact", path: "/contact" },
  ];
  const legalLinks = [
    { label: t("footer.returnsPolicy"), path: "/policies/returns" },
    { label: t("footer.privacy"), path: "/policies/privacy" },
    { label: t("footer.terms"), path: "/policies/terms" },
    { label: t("footer.accessibility"), path: "/accessibility" },
  ];

  return (
    <footer className="site-footer theme-dark">
      <div className="container">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <img src="/brand/logo-white.svg" alt="CROWNED" width={170} height={43} />
            <p className="text-muted text-sm" style={{ maxWidth: "34ch" }}>
              {t("meta.tagline")}
            </p>
            <div className="row">
              {settings?.instagramUsername && (
                <a
                  className="icon-btn"
                  href={`https://instagram.com/${settings.instagramUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  onClick={() => track("instagram_click", { placement: "footer" })}
                >
                  <IconInstagram />
                </a>
              )}
              {settings?.whatsappNumber && (
                <a
                  className="icon-btn"
                  href={whatsappLink(settings.whatsappNumber, locale, { intent: "general" })}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  onClick={() => track("whatsapp_click", { placement: "footer" })}
                >
                  <IconWhatsApp />
                </a>
              )}
            </div>
          </div>

          <FooterCol title={t("footer.shop")}>
            {shopLinks.map((l) => (
              <Link key={l.path} to={`${P}${l.path}`}>
                {t(`nav.${l.key}`)}
              </Link>
            ))}
          </FooterCol>

          <FooterCol title={t("footer.help")}>
            {helpLinks.map((l) => (
              <Link key={l.path} to={`${P}${l.path}`}>
                {"key" in l && l.key ? t(`nav.${l.key}`) : l.label}
              </Link>
            ))}
          </FooterCol>

          <FooterCol title={t("footer.legal")}>
            {legalLinks.map((l) => (
              <Link key={l.path} to={`${P}${l.path}`}>
                {l.label}
              </Link>
            ))}
          </FooterCol>

          <div className="site-footer__signup">
            <h3 className="site-footer__title">{t("footer.newsletterTitle")}</h3>
            <p className="text-muted text-sm">{t("home.signupBody")}</p>
            <SignupForm />
          </div>
        </div>

        <hr className="divider" />
        <p className="text-xs text-muted site-footer__disclosure">{settings ? L(settings.nonAffiliationNote) : t("footer.nonAffiliation")}</p>
        <div className="row row--between row--wrap mt-4">
          <p className="text-xs text-muted">© {new Date().getFullYear()} CROWNED. {t("footer.rights")}</p>
          {isDemoMode() && <p className="text-xs" style={{ color: "var(--gold-400)" }}>{t("common.demoFooterNote")}</p>}
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="site-footer__col">
      <h3 className="site-footer__title">{title}</h3>
      <nav className="site-footer__links" aria-label={title}>
        {children}
      </nav>
    </div>
  );
}

function SignupForm() {
  const { t } = useI18n();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setError(null);
    // Consent is explicit: submitting this form IS the opt-in action; no
    // pre-ticked boxes, consent source recorded (spec §23).
    await dataService().submitLead({ kind: "email", value: v, consent: true, consentSource: "footer_signup" });
    setDone(true);
    toast.push(t("common.signupThanks"));
  };

  if (done) return <p className="text-sm" style={{ color: "var(--gold-400)" }}>{t("common.signupThanks")}</p>;
  return (
    <form onSubmit={submit} className="site-footer__form" noValidate>
      <label className="sr-only" htmlFor="footer-email">
        {t("footer.newsletterPlaceholder")}
      </label>
      <input
        id="footer-email"
        type="email"
        className="input"
        placeholder={t("footer.newsletterPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "footer-email-err" : undefined}
      />
      {error && (
        <p className="field__error" id="footer-email-err">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--gold">
        {t("footer.newsletterSubmit")}
      </button>
    </form>
  );
}
