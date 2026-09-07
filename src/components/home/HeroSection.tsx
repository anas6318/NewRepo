/**
 * Homepage hero — full-width, cinematic, content-driven.
 *
 * Pure presentation: receives a typed `HeroBanner` via props (currently from
 * src/content/hero.ts, later replaceable by a Supabase `hero_banners` row
 * without touching this component). Supports separate desktop/mobile image
 * sources, configurable text alignment and overlay strength, a subtle
 * entrance animation (disabled under prefers-reduced-motion via the global
 * motion-safety rules), and correct RTL/LTR behavior through logical
 * properties.
 */
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import type { HeroBanner } from "../../content/hero.ts";

const MOBILE_MEDIA = "(max-width: 720px)";

export function HeroSection({ banner }: { banner: HeroBanner }) {
  const { locale, t } = useI18n();
  const P = `/${locale}`;

  return (
    <section className={`hero hero--overlay-${banner.overlay} hero--align-${banner.align} theme-dark`}>
      <picture>
        {banner.image.mobileSrc !== banner.image.desktopSrc && <source media={MOBILE_MEDIA} srcSet={banner.image.mobileSrc} />}
        <img
          src={banner.image.desktopSrc}
          alt={t(banner.image.altKey)}
          className="hero__bg"
          width={banner.image.width}
          height={banner.image.height}
          fetchPriority="high"
          decoding="async"
        />
      </picture>

      <div className="container hero__content">
        <p className="eyebrow hero__eyebrow">{t(banner.eyebrowKey)}</p>
        <h1 className="hero__title">{t(banner.headlineKey)}</h1>
        <p className="hero__sub">{t(banner.descriptionKey)}</p>
        <div className="hero__ctas">
          <Link to={`${P}${banner.primaryCta.path}`} className="btn btn--gold btn--lg">
            {t(banner.primaryCta.labelKey)}
          </Link>
          {banner.secondaryCta && (
            <Link to={`${P}${banner.secondaryCta.path}`} className="btn btn--outline btn--lg">
              {t(banner.secondaryCta.labelKey)}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
