/** Premium homepage — section rhythm per spec §28: alternating dark
 * cinematic editorial and clean light shopping sections. */
import { useEffect, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta, organizationJsonLd } from "../../lib/seo.tsx";
import { useSettings } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import type { CategoryDef, Product, Review } from "../../services/types.ts";
import { ProductCard } from "../../components/product/ProductCard.tsx";
import { SectionHead, Stars, useL } from "../../components/ui/bits.tsx";
import { IconArrow, IconCheck, IconCrown, IconRuler, IconShield, IconTruck, IconWhatsApp } from "../../components/ui/Icons.tsx";
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
  const [current, setCurrent] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    let alive = true;
    void dataServiceSafe(async (svc) => {
      const [cats, feat, r, c, revs] = await Promise.all([
        svc.listCategories(),
        svc.listProducts({ featured: true }),
        svc.listProducts({ category: "retro", sort: "newest" }),
        svc.listProducts({ category: "current-season" }),
        svc.listApprovedReviews(),
      ]);
      if (!alive) return;
      setCategories(cats);
      setFeatured(feat.slice(0, 4));
      setRetro(r.slice(0, 4));
      setCurrent(c.slice(0, 4));
      setReviews(revs.slice(0, 3));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main id="main">
      {/* 3 — Cinematic hero (dark) */}
      <section className="hero theme-dark">
        <img src="/demo/hero.webp" alt="" className="hero__bg" fetchPriority="high" />
        <div className="container hero__content">
          <p className="eyebrow">CROWNED</p>
          <h1 className="hero__title">{t("home.heroTitle")}</h1>
          <p className="hero__sub">{t("home.heroSubtitle")}</p>
          <div className="hero__ctas">
            <Link to={`${P}/shop`} className="btn btn--gold btn--lg">
              {t("home.heroCtaPrimary")}
            </Link>
            <Link to={`${P}/category/retro`} className="btn btn--outline btn--lg">
              {t("home.heroCtaSecondary")}
            </Link>
          </div>
        </div>
      </section>

      {/* 4 — Main categories (light) */}
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

      {/* 5 — Featured retro archive (dark editorial) */}
      <section className="section theme-dark">
        <div className="container">
          <SectionHead
            eyebrow={t("home.retroSubtitle")}
            title={t("home.retroTitle")}
            action={
              <Link to={`${P}/category/retro`} className="btn btn--outline btn--sm">
                {t("common.viewAll")} <IconArrow size={14} />
              </Link>
            }
          />
          <div className="prod-grid">
            {retro.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* 6+7 — Clean product grid / current season (white) */}
      <section className="section theme-white">
        <div className="container">
          <SectionHead
            title={t("home.currentSeasonTitle")}
            action={
              <Link to={`${P}/category/current-season`} className="btn btn--outline btn--sm">
                {t("common.viewAll")} <IconArrow size={14} />
              </Link>
            }
          />
          <div className="prod-grid">
            {(current.length ? current : featured).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* 8 — Fan vs Player explanation (light) */}
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

      {/* 9 — Personalization (dark) */}
      <section className="section theme-dark">
        <div className="container editorial">
          <img src="/demo/editorial.webp" alt="" loading="lazy" />
          <div className="editorial__content">
            <p className="eyebrow">{t("home.personalizationTitle")}</p>
            <h2 className="section__title" style={{ maxWidth: "16ch" }}>
              {t("home.personalizationBody")}
            </h2>
            <p className="text-muted" style={{ maxWidth: "40ch" }}>
              {t("home.personalizationDetail")}
            </p>
            <Link to={`${P}/shop`} className="btn btn--gold" style={{ alignSelf: "flex-start" }}>
              {t("home.heroCtaPrimary")}
            </Link>
          </div>
        </div>
      </section>

      {/* 10 — How ordering works (white) */}
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
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="step">
                <span className="step__num">0{n}</span>
                <h3 className="step__title">{t(`home.step${n}Title`)}</h3>
                <p>{t(`home.step${n}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 11 — Free delivery banner (dark) */}
      <section className="section--tight section theme-dark">
        <div className="container center-text stack" style={{ alignItems: "center" }}>
          <IconCrown size={34} />
          <h2 className="section__title">{t("home.freeDeliveryTitle")}</h2>
          <p className="text-muted" style={{ maxWidth: "52ch" }}>
            {t("home.freeDeliveryBody")}
          </p>
          <Link to={`${P}/shop`} className="btn btn--gold">
            {t("home.heroCtaPrimary")}
          </Link>
        </div>
      </section>

      {/* 12+13 — Editorial culture + reviews (light) */}
      <section className="section theme-light">
        <div className="container">
          <SectionHead
            eyebrow={t("home.editorialTitle")}
            title={t("home.reviewsTitle")}
            action={
              <Link to={`${P}/reviews`} className="btn btn--outline btn--sm">
                {t("common.viewAll")}
              </Link>
            }
          />
          <div className="grid-3">
            {reviews.map((r) => (
              <blockquote key={r.id} className="review-card" dir={r.locale === "en" ? "ltr" : "rtl"} lang={r.locale}>
                <Stars rating={r.rating} />
                <p className="review-card__body">{r.body}</p>
                <footer className="review-card__meta">
                  <span>{r.displayName}</span>
                  {r.verified && (
                    <span className="badge badge--ok">
                      <IconCheck size={12} /> {t("reviews.verifiedPurchase")}
                    </span>
                  )}
                  {r.isDemo && <span className="badge badge--demo">{t("common.demoLabel")}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* 14 — Size guide CTA + 17 trust (white) */}
      <section className="section theme-white">
        <div className="container stack--lg stack">
          <div className="trust-strip">
            <div className="trust-strip__item">
              <IconRuler size={22} />
              <div>
                <h3>{t("home.sizeGuideCtaTitle")}</h3>
                <p>
                  {t("home.sizeGuideCtaBody")}{" "}
                  <Link to={`${P}/size-guide`} className="text-gold">
                    {t("nav.sizeGuide")} →
                  </Link>
                </p>
              </div>
            </div>
            <div className="trust-strip__item">
              <IconTruck size={22} />
              <div>
                <h3>{t("home.trustDeliveryTitle")}</h3>
                <p>{settings ? L(settings.supplierEtaText) : t("home.trustDeliveryBody")}</p>
              </div>
            </div>
            <div className="trust-strip__item">
              <IconShield size={22} />
              <div>
                <h3>{t("home.trustQualityTitle")}</h3>
                <p>{t("home.trustQualityBody")}</p>
              </div>
            </div>
            <div className="trust-strip__item">
              <IconWhatsApp size={22} />
              <div>
                <h3>{t("home.trustSupportTitle")}</h3>
                <p>{t("home.trustSupportBody")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 15+16 — Instagram + signup (dark) */}
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
