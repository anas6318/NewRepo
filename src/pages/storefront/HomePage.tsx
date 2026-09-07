/** Premium homepage — V2 information architecture.
 *
 * Journey: Hero (brand) → Trust bar (instant reassurance) → Collections
 * (orient) → Curated Selection (desire) → Fan vs Player (answer the #1
 * question) → How It Works (3 steps, remove friction) → Why CROWNED (brand
 * conviction) → CROWNED Studio (one-of-one custom jerseys — the grand
 * finale, revealed only after trust is established) → Instagram (lifestyle
 * social proof). One idea per section; dark/light rhythm preserved.
 * Reviews return once enough verified orders exist. */
import { useEffect, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta, organizationJsonLd } from "../../lib/seo.tsx";
import { useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import type { CategoryDef, Product } from "../../services/types.ts";
import { ProductCard } from "../../components/product/ProductCard.tsx";
import { HeroSection } from "../../components/home/HeroSection.tsx";
import { HOME_HERO } from "../../content/hero.ts";
import { SectionHead, useL } from "../../components/ui/bits.tsx";
import { IconArrow, IconCrown, IconShield, IconShirt, IconTruck, IconWhatsApp } from "../../components/ui/Icons.tsx";
import { whatsappLink } from "../../lib/whatsapp.ts";
import { dataServiceSafe } from "./page-utils.ts";

export function HomePage() {
  const { locale, t } = useI18n();
  const { settings } = useSettings();
  const L = useL();
  const P = `/${locale}`;

  usePageMeta({
    title: t("meta.defaultTitle"),
    description: t("meta.defaultDescription"),
    path: "/",
    locale,
    jsonLd: [organizationJsonLd()],
  });

  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [featured, setFeatured] = useState<Product[]>([]);
  const [retro, setRetro] = useState<Product[]>([]);

  useEffect(() => {
    let alive = true;
    void dataServiceSafe(async (svc) => {
      const [cats, feat, r] = await Promise.all([
        svc.listCategories(),
        svc.listProducts({ featured: true }),
        svc.listProducts({ category: "retro", sort: "newest" }),
      ]);
      if (!alive) return;
      setCategories(cats);
      setFeatured(feat.slice(0, 4));
      setRetro(r.slice(0, 4));
    });
    return () => {
      alive = false;
    };
  }, []);

  /** The curated grid shows admin-featured pieces; retro is the fallback
   * so the section never renders empty. */
  const curated = featured.length ? featured : retro;

  const trustPoints = [
    { icon: <IconShield size={22} />, titleKey: "home.trustQualityTitle", bodyKey: "home.trustQualityBody" },
    { icon: <IconShirt size={22} />, titleKey: "home.trustPrintingTitle", bodyKey: "home.trustPrintingBody" },
    { icon: <IconTruck size={22} />, titleKey: "home.trustDeliveryTitle", bodyKey: "home.trustDeliveryBody" },
    { icon: <IconWhatsApp size={22} />, titleKey: "home.trustSupportTitle", bodyKey: "home.trustSupportBody" },
  ];

  return (
    <main id="main">
      {/* 2 — Hero (dark) — content config: src/content/hero.ts */}
      <HeroSection banner={HOME_HERO} />

      {/* 3 — Compact trust bar: reassure immediately after the hero */}
      <section className="trust-bar theme-white" aria-label={t("home.trustTitle")}>
        <div className="container trust-bar__grid">
          {trustPoints.map((point) => (
            <div key={point.titleKey} className="trust-bar__item">
              {point.icon}
              <div>
                <h3>{t(point.titleKey)}</h3>
                <p>{t(point.bodyKey)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4 — Collections (light) */}
      <section className="section theme-light">
        <div className="container">
          <SectionHead title={t("home.categoriesTitle")} />
          <div className="cat-grid">
            {categories.map((cat) => (
              <Link
                key={cat.slug}
                to={`${P}/category/${cat.slug}`}
                className="cat-tile"
                onClick={() => track("view_category", { category: cat.slug })}
              >
                <img src={cat.image} alt="" loading="lazy" width={400} height={500} />
                <span className="cat-tile__label">
                  {L(cat.name)}
                  <IconArrow size={16} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 5 — Curated Selection (dark editorial): one product edit, not two grids */}
      <section className="section theme-dark">
        <div className="container">
          <SectionHead
            eyebrow={t("home.retroSubtitle")}
            title={t("home.curatedTitle")}
            action={
              <Link to={`${P}/shop`} className="btn btn--outline btn--sm">
                {t("common.viewAll")} <IconArrow size={14} />
              </Link>
            }
          />
          <div className="prod-grid">
            {curated.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* 6 — Fan vs Player (light): the #1 customer question, scannable */}
      <section className="section theme-light">
        <div className="container">
          <SectionHead title={t("home.versionExplainerTitle")} sub={t("home.versionExplainerBody")} />
          <div className="versus">
            <div className="versus__card">
              <p className="eyebrow">{t("product.versionFan")}</p>
              <h3>{t("home.fanCardTitle")}</h3>
              <ul>
                <li>{t("home.fanPoint1")}</li>
                <li>{t("home.fanPoint2")}</li>
                <li>{t("home.fanPoint3")}</li>
              </ul>
              <Link to={`${P}/category/fan-version`} className="btn btn--dark btn--sm" style={{ alignSelf: "flex-start" }}>
                {t("nav.fanVersion")}
              </Link>
            </div>
            <div className="versus__card">
              <p className="eyebrow">{t("product.versionPlayer")}</p>
              <h3>{t("home.playerCardTitle")}</h3>
              <ul>
                <li>{t("home.playerPoint1")}</li>
                <li>{t("home.playerPoint2")}</li>
                <li>{t("home.playerPoint3")}</li>
              </ul>
              <Link to={`${P}/category/player-version`} className="btn btn--dark btn--sm" style={{ alignSelf: "flex-start" }}>
                {t("nav.playerVersion")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 7 — How ordering works (white): three steps, zero friction */}
      <section className="section theme-white">
        <div className="container">
          <SectionHead
            title={t("home.howItWorksTitle")}
            action={
              <Link to={`${P}/how-it-works`} className="btn btn--outline btn--sm">
                {t("common.learnMore")}
              </Link>
            }
          />
          <div className="steps">
            {[1, 2, 3].map((n) => (
              <div key={n} className="step">
                <span className="step__num">0{n}</span>
                <h3 className="step__title">{t(`home.step${n}Title`)}</h3>
                <p>{t(`home.step${n}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8 — Why CROWNED (light): brand conviction, not repeated trust points */}
      <section className="section--tight section theme-light">
        <div className="container center-text stack" style={{ alignItems: "center" }}>
          <IconCrown size={34} />
          <h2 className="section__title">{t("home.whyTitle")}</h2>
          <p className="text-muted" style={{ maxWidth: "56ch" }}>
            {t("home.whyBody")}
          </p>
          <Link to={`${P}/shop`} className="btn btn--dark">
            {t("home.heroCtaPrimary")}
          </Link>
        </div>
      </section>

      {/* 9 — CROWNED Studio (grand finale): one-of-one custom jerseys.
           Full-bleed editorial banner — imagery sells it, copy stays minimal. */}
      <section className="custom-hero theme-dark">
        <img
          src="/demo/editorial.webp"
          alt={t("home.customImageAlt")}
          className="custom-hero__bg"
          loading="lazy"
          width={1600}
          height={900}
        />
        <div className="container custom-hero__content">
          <p className="eyebrow custom-hero__eyebrow">{t("home.customEyebrow")}</p>
          <h2 className="custom-hero__title">{t("home.customTitle")}</h2>
          <p className="custom-hero__sub">{t("home.customBody")}</p>
          {settings?.whatsappNumber ? (
            <a
              href={whatsappLink(settings.whatsappNumber, locale, { intent: "general" })}
              target="_blank"
              rel="noreferrer"
              className="btn btn--gold btn--lg"
              onClick={() => track("whatsapp_click", { placement: "home_custom_studio" })}
            >
              {t("home.customCta")}
            </a>
          ) : (
            <Link to={`${P}/contact`} className="btn btn--gold btn--lg">
              {t("home.customCta")}
            </Link>
          )}
        </div>
      </section>

      {/* 10 — Instagram + WhatsApp (dark): lifestyle social proof */}
      <section className="section theme-dark">
        <div className="container grid-2">
          <div className="stack">
            <p className="eyebrow">Instagram</p>
            <h2 className="section__title">{t("home.instagramTitle")}</h2>
            {settings?.instagramUsername && (
              <a
                href={`https://instagram.com/${settings.instagramUsername}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn--outline"
                style={{ alignSelf: "flex-start" }}
                onClick={() => track("instagram_click", { placement: "home" })}
              >
                @{settings.instagramUsername}
              </a>
            )}
          </div>
          <div className="stack">
            <p className="eyebrow">{t("home.signupTitle")}</p>
            <h2 className="section__title" style={{ fontSize: "var(--fs-2xl)" }}>
              {t("home.signupBody")}
            </h2>
            {settings?.whatsappNumber && (
              <a
                href={whatsappLink(settings.whatsappNumber, locale, { intent: "general" })}
                target="_blank"
                rel="noreferrer"
                className="btn btn--gold"
                style={{ alignSelf: "flex-start" }}
                onClick={() => track("whatsapp_click", { placement: "home_signup" })}
              >
                <IconWhatsApp size={18} /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
