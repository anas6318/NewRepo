/** Content pages: About, How ordering works, Delivery, FAQ, Contact. */
import { useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { useSettings, useToast } from "../../services/store.tsx";
import { getConfig } from "../../lib/env.ts";
import { track } from "../../lib/analytics.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";
import { useL } from "../../components/ui/bits.tsx";
import { Field } from "../../components/product/ReviewsSection.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { IconInstagram, IconPlus, IconWhatsApp } from "../../components/ui/Icons.tsx";

function InfoShell({ slug, title, children }: { slug: string; title: string; children: React.ReactNode }) {
  return (
    <main id="main" className="container--narrow container section--tight section">
      <Breadcrumbs items={[{ label: title, path: `/${slug}` }]} />
      <h1 className="section__title mb-6">{title}</h1>
      {children}
    </main>
  );
}

export function AboutPage() {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();
  usePageMeta({ title: t("nav.about"), description: t("about.intro"), path: "/about", locale });
  return (
    <InfoShell slug="about" title={t("nav.about")}>
      <div className="prose stack">
        <p className="text-lg" style={{ fontSize: "var(--fs-lg)" }}>{t("about.intro")}</p>
        <p className="text-muted">{t("about.body1")}</p>
        <p className="text-muted">{t("about.body2")}</p>
        <hr className="divider" />
        <p className="text-sm text-muted">{settings ? L(settings.nonAffiliationNote) : ""}</p>
      </div>
    </InfoShell>
  );
}

export function HowItWorksPage() {
  const { locale, t } = useI18n();
  usePageMeta({ title: t("footer.howOrdering"), description: t("how.intro"), path: "/how-it-works", locale });
  const steps = [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <InfoShell slug="how-it-works" title={t("footer.howOrdering")}>
      <p className="text-muted mb-8">{t("how.intro")}</p>
      <ol className="timeline card">
        {steps.map((n, i) => (
          <li key={n} className={i === 0 ? "is-current" : "is-pending"}>
            <span className="timeline__dot" />
            <p className="timeline__label">{t(`how.step${n}Title`)}</p>
            <p className="timeline__meta">{t(`how.step${n}Body`)}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted mt-6">{t("how.etaNote")}</p>
      <Link to={`/${locale}/shop`} className="btn btn--gold mt-4" style={{ display: "inline-flex" }}>
        {t("home.heroCtaPrimary")}
      </Link>
    </InfoShell>
  );
}

export function DeliveryPage() {
  const { locale, t } = useI18n();
  const { settings, zones } = useSettings();
  const L = useL();
  const intl = getConfig().internationalMode;
  usePageMeta({ title: t("footer.delivery"), description: t("delivery.intro"), path: "/delivery", locale });
  return (
    <InfoShell slug="delivery" title={t("footer.delivery")}>
      <div className="stack stack--lg">
        <p className="text-muted">{t("delivery.intro")}</p>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 0 }}>
            <caption className="sr-only">{t("delivery.zonesTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("delivery.zone")}</th>
                <th scope="col">{t("cart.delivery")}</th>
                <th scope="col">{t("delivery.eta")}</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td>{L(z.name)}</td>
                  <td className="num">₪{z.priceIls}</td>
                  <td className="num">
                    {z.etaDays} {t("checkout.days")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card stack--sm stack" style={{ borderColor: "var(--gold-500)" }}>
          <strong>{t("home.freeDeliveryTitle")}</strong>
          <p className="text-sm text-muted">{t("home.freeDeliveryBody")}</p>
        </div>
        <p className="text-sm text-muted">{settings ? L(settings.supplierEtaText) : ""} — {t("delivery.etaClarification")}</p>
        {(intl === "disabled" || intl === "waitlist") && settings && (
          <div className="card stack--sm stack">
            <strong>{t("delivery.internationalTitle")}</strong>
            <p className="text-sm text-muted">{L(settings.internationalNote)}</p>
            {intl === "waitlist" && settings.whatsappNumber && (
              <a className="btn btn--outline btn--sm" style={{ alignSelf: "flex-start" }} href={whatsappLink(settings.whatsappNumber, locale, { intent: "international" })} target="_blank" rel="noreferrer">
                <IconWhatsApp size={14} /> {t("delivery.joinWaitlist")}
              </a>
            )}
          </div>
        )}
      </div>
    </InfoShell>
  );
}

export function FaqPage() {
  const { locale, t } = useI18n();
  usePageMeta({ title: t("footer.faq"), description: t("faq.intro"), path: "/faq", locale });
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <InfoShell slug="faq" title={t("footer.faq")}>
      <p className="text-muted mb-6">{t("faq.intro")}</p>
      <div className="accordion">
        {items.map((n) => (
          <FaqItem key={n} q={t(`faq.q${n}`)} a={t(`faq.a${n}`)} />
        ))}
      </div>
    </InfoShell>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`accordion__item${open ? " is-open" : ""}`}>
      <button type="button" className="accordion__trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {q}
        <IconPlus size={18} className="accordion__icon" />
      </button>
      {open && <div className="accordion__panel">{a}</div>}
    </div>
  );
}

export function ContactPage() {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const toast = useToast();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageMeta({ title: t("nav.contact"), description: t("contact.intro"), path: "/contact", locale });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || contact.trim().length < 4 || message.trim().length < 5) {
      setError(t("contact.validation"));
      return;
    }
    setError(null);
    await dataService().submitIssueReport({
      orderNumber: "-",
      name: name.trim(),
      contact: contact.trim(),
      category: "other",
      description: `[contact form] ${message.trim()}`,
      requestedResolution: "",
    });
    setDone(true);
    toast.push(t("contact.received"));
  };

  return (
    <InfoShell slug="contact" title={t("nav.contact")}>
      <div className="grid-2">
        <div className="stack">
          <p className="text-muted">{t("contact.intro")}</p>
          {settings?.whatsappNumber && (
            <a className="btn btn--gold" style={{ alignSelf: "flex-start" }} href={whatsappLink(settings.whatsappNumber, locale, { intent: "general" })} target="_blank" rel="noreferrer" onClick={() => track("whatsapp_click", { placement: "contact" })}>
              <IconWhatsApp size={16} /> WhatsApp
            </a>
          )}
          {settings?.instagramUsername && (
            <a className="btn btn--outline" style={{ alignSelf: "flex-start" }} href={`https://instagram.com/${settings.instagramUsername}`} target="_blank" rel="noreferrer" onClick={() => track("instagram_click", { placement: "contact" })}>
              <IconInstagram size={16} /> @{settings.instagramUsername}
            </a>
          )}
        </div>
        {done ? (
          <p className="badge badge--ok" style={{ alignSelf: "flex-start" }}>
            {t("contact.received")}
          </p>
        ) : (
          <form className="card stack" onSubmit={submit} noValidate>
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            <Field id="ct-name" label={t("checkout.fullName")} required>
              <input id="ct-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="ct-contact" label={t("issues.contact")} required>
              <input id="ct-contact" className="input" dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <Field id="ct-msg" label={t("contact.message")} required>
              <textarea id="ct-msg" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn--gold" style={{ alignSelf: "flex-start" }}>
              {t("contact.send")}
            </button>
          </form>
        )}
      </div>
    </InfoShell>
  );
}
