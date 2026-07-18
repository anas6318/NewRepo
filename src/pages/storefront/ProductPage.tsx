/** Product page (spec §29): conditional options, free name/number, ₪5
 * patches, dynamic pricing, size guide, reviews, related products. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta, breadcrumbJsonLd, productJsonLd } from "../../lib/seo.tsx";
import { dataService } from "../../services/index.ts";
import { buildCartLine, useCart, useSettings, useToast, useWishlist } from "../../services/store.tsx";
import { track } from "../../lib/analytics.ts";
import { priceLine } from "../../lib/pricing.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";
import type { JerseyVersion, PatchDef, Product, SleeveStyle } from "../../services/types.ts";
import { Gallery } from "../../components/product/Gallery.tsx";
import { SizeGuideDialog } from "../../components/product/SizeGuideDialog.tsx";
import { ReviewsSection, Field } from "../../components/product/ReviewsSection.tsx";
import { ProductCard } from "../../components/product/ProductCard.tsx";
import { Breadcrumbs } from "../../components/layout/Breadcrumbs.tsx";
import { DemoBadge, Price, StatusBadge, useL } from "../../components/ui/bits.tsx";
import { IconBag, IconHeart, IconMinus, IconPlus, IconWhatsApp } from "../../components/ui/Icons.tsx";
import { NotFoundPage } from "./ErrorPages.tsx";

export function ProductPage({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const L = useL();
  const navigate = useNavigate();
  const cart = useCart();
  const wishlist = useWishlist();
  const toast = useToast();
  const { settings } = useSettings();

  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [patches, setPatches] = useState<PatchDef[]>([]);
  const [related, setRelated] = useState<Product[]>([]);

  /* selection state */
  const [version, setVersion] = useState<JerseyVersion | undefined>();
  const [sleeve, setSleeve] = useState<SleeveStyle | undefined>();
  const [size, setSize] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [customNumber, setCustomNumber] = useState("");
  const [patchId, setPatchId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [spellingOk, setSpellingOk] = useState(false);
  const [sizeOk, setSizeOk] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    let alive = true;
    setProduct(undefined);
    setVersion(undefined);
    setSleeve(undefined);
    setSize("");
    setCustomName("");
    setCustomNumber("");
    setPatchId("");
    setQuantity(1);
    setSpellingOk(false);
    setSizeOk(false);
    setAttempted(false);
    Promise.all([dataService().getProduct(slug), dataService().listPatches()])
      .then(([p, pats]) => {
        if (!alive) return;
        setProduct(p);
        setPatches(pats);
        if (p) {
          track("view_item", { item_id: p.slug, price: p.basePriceIls });
          if (p.versions.length === 1) setVersion(p.versions[0]?.version);
          if (p.sleeves.length === 1) setSleeve(p.sleeves[0]);
          if (p.relatedSlugs.length) {
            Promise.all(p.relatedSlugs.map((s) => dataService().getProduct(s)))
              .then((rel) => alive && setRelated(rel.filter((x): x is Product => !!x)))
              .catch(() => undefined);
          } else {
            dataService()
              .listProducts({ category: p.categorySlug })
              .then((all) => alive && setRelated(all.filter((x) => x.slug !== p.slug).slice(0, 4)))
              .catch(() => undefined);
          }
        }
      })
      .catch(() => alive && setProduct(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  const availablePatches = useMemo(() => patches.filter((p) => p.active && (product?.patchIds.includes(p.id) ?? false)), [patches, product]);
  const selectedPatch = availablePatches.find((p) => p.id === patchId);
  const personalized = customName.trim() !== "" || customNumber.trim() !== "";

  const priced = useMemo(() => {
    if (!product) return null;
    const adjustments: number[] = [];
    if (version) {
      const v = product.versions.find((x) => x.version === version);
      if (v) adjustments.push(v.adjustmentIls);
    }
    if (sleeve === "long" && product.sleeves.length > 1) adjustments.push(product.longSleeveAdjustmentIls);
    try {
      return priceLine({
        basePriceIls: product.basePriceIls,
        adjustmentsIls: adjustments,
        patchPriceIls: selectedPatch?.priceIls ?? 0,
        quantity,
      });
    } catch {
      return null;
    }
  }, [product, version, sleeve, selectedPatch, quantity]);

  const title = product ? L(product.name) : "";
  usePageMeta({
    title: title || "…",
    description: product ? L(product.seoDescription) || L(product.description) : undefined,
    path: `/product/${slug}`,
    locale,
    ogImage: product?.images[0]?.src,
    jsonLd: product
      ? [
          productJsonLd({
            name: title,
            description: L(product.description),
            image: product.images[0]?.src ?? "",
            priceIls: product.basePriceIls,
            slug: product.slug,
            locale,
            available: product.status !== "unavailable",
          }),
          breadcrumbJsonLd(
            [
              { name: t("nav.shop"), path: "/shop" },
              { name: title, path: `/product/${slug}` },
            ],
            locale,
          ),
        ]
      : [],
  });

  if (product === undefined) {
    return (
      <main id="main" className="container section" aria-busy="true">
        <div className="grid-2">
          <div className="skeleton" style={{ aspectRatio: "4/5", borderRadius: "var(--r-md)" }} />
          <div className="stack">
            <div className="skeleton" style={{ height: 32, width: "70%" }} />
            <div className="skeleton" style={{ height: 20, width: "30%" }} />
            <div className="skeleton" style={{ height: 200 }} />
          </div>
        </div>
      </main>
    );
  }
  if (product === null) return <NotFoundPage />;

  const unavailable = product.status === "unavailable";

  const validate = (): string | null => {
    if (product.versions.length > 1 && !version) return t("errors.selectVersion");
    if (!size) return t("errors.selectSize");
    if (personalized && !spellingOk) return t("errors.confirmSpelling");
    if (!sizeOk) return t("errors.confirmSize");
    if (customNumber && !/^\d{1,2}$/.test(customNumber.trim())) return t("errors.invalidNumber");
    if (customName && !/^[\p{L}\p{M}' .-]{1,14}$/u.test(customName.trim())) return t("errors.invalidName");
    return null;
  };

  const addToCart = (): boolean => {
    setAttempted(true);
    const err = validate();
    if (err) {
      toast.push(err, "error");
      return false;
    }
    if (!priced) return false;
    cart.add(
      buildCartLine(product, {
        version,
        sleeve,
        size,
        personalization: personalized ? { name: customName.trim() || undefined, number: customNumber.trim() || undefined } : undefined,
        patchId: patchId || undefined,
        patchName: selectedPatch?.name,
        unitPriceIls: priced.unitPriceIls,
        quantity,
      }),
    );
    track("add_to_cart", { item_id: product.slug, value: priced.lineTotalIls, quantity });
    return true;
  };

  const buyNow = () => {
    if (addToCart()) {
      cart.setDrawerOpen(false);
      navigate(`/${locale}/checkout`);
    }
  };

  const versionLabel = (v: JerseyVersion) =>
    v === "fan" ? t("product.versionFan") : v === "player" ? t("product.versionPlayer") : v === "kids" ? t("nav.kids") : t("nav.retro");

  const chartId = product.kids ? "kids" : product.categorySlug === "hoodies" ? "hoodie" : product.categorySlug === "long-sleeve" ? "long-sleeve" : version === "player" ? "player" : product.categorySlug === "retro" ? "retro" : "fan";

  return (
    <main id="main" className="container section--tight section">
      <Breadcrumbs
        items={[
          { label: t("nav.shop"), path: "/shop" },
          { label: title, path: `/product/${slug}` },
        ]}
      />
      <div className="product-layout">
        <Gallery product={product} />

        <div className="product-panel stack">
          <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
            {product.isDemo && <DemoBadge />}
            <StatusBadge status={product.status} />
          </div>
          <h1 className="product-title">{title}</h1>
          <div className="row">
            {priced && <Price ils={priced.unitPriceIls} compareIls={product.compareAtPriceIls} className="product-price" />}
            <span className="text-xs text-muted">{t("product.priceUpdatesNote")}</span>
          </div>
          <p className="text-muted">{L(product.description)}</p>

          {/* version */}
          {product.versions.length > 1 && (
            <fieldset className="field" aria-required="true">
              <legend className="field__label">
                {t("product.version")} <span className="req">*</span>
              </legend>
              <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
                {product.versions.map((v) => (
                  <button key={v.version} type="button" className={`chip${version === v.version ? " is-selected" : ""}`} aria-pressed={version === v.version} onClick={() => setVersion(v.version)}>
                    {versionLabel(v.version)}
                    {v.adjustmentIls > 0 && <bdi> +₪{v.adjustmentIls}</bdi>}
                  </button>
                ))}
              </div>
              {attempted && product.versions.length > 1 && !version && (
                <p className="field__error" role="alert">
                  {t("errors.selectVersion")}
                </p>
              )}
            </fieldset>
          )}

          {/* sleeve */}
          {product.sleeves.length > 1 && (
            <fieldset className="field">
              <legend className="field__label">{t("product.sleeve")}</legend>
              <div className="row" style={{ gap: "var(--sp-2)" }}>
                {product.sleeves.map((sl) => (
                  <button key={sl} type="button" className={`chip${sleeve === sl ? " is-selected" : ""}`} aria-pressed={sleeve === sl} onClick={() => setSleeve(sl)}>
                    {sl === "short" ? t("product.sleeveShort") : t("product.sleeveLong")}
                    {sl === "long" && product.longSleeveAdjustmentIls > 0 && <bdi> +₪{product.longSleeveAdjustmentIls}</bdi>}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {/* size */}
          <fieldset className="field" aria-required="true">
            <legend className="field__label row row--between w-full">
              <span>
                {t("product.size")} <span className="req">*</span>
              </span>
              <SizeGuideDialog chartId={chartId} />
            </legend>
            <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
              {product.sizes.map((sz) => (
                <button key={sz} type="button" className={`chip${size === sz ? " is-selected" : ""}`} aria-pressed={size === sz} onClick={() => setSize(sz)}>
                  {sz}
                </button>
              ))}
            </div>
            {attempted && !size && (
              <p className="field__error" role="alert">
                {t("errors.selectSize")}
              </p>
            )}
            {settings?.whatsappNumber && (
              <a
                className="text-sm text-gold"
                href={whatsappLink(settings.whatsappNumber, locale, { intent: "size-help", productTitle: title, productUrl: `${location.origin}/${locale}/product/${slug}` })}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("whatsapp_click", { placement: "size_help" })}
              >
                <IconWhatsApp size={14} /> {t("product.needHelpSizing")}
              </a>
            )}
          </fieldset>

          {/* personalization — free (spec §10) */}
          {product.personalizable && (
            <fieldset className="field">
              <legend className="field__label">
                {t("home.personalizationTitle")} <span className="badge badge--gold">{t("product.freeLabel")}</span>
              </legend>
              <div className="form-grid">
                <Field id="p-name" label={t("product.customName")} hint={t("product.customNamePlaceholder")}>
                  <input id="p-name" className="input" maxLength={14} value={customName} dir="auto" onChange={(e) => setCustomName(e.target.value)} placeholder="RONALDO" />
                </Field>
                <Field id="p-number" label={t("product.customNumber")} hint={t("product.customNumberPlaceholder")}>
                  <input id="p-number" className="input num" inputMode="numeric" maxLength={2} value={customNumber} onChange={(e) => setCustomNumber(e.target.value.replace(/[^0-9]/g, ""))} placeholder="7" />
                </Field>
              </div>
              {personalized && (
                <>
                  <div className="perso-preview" aria-hidden="true">
                    <span className="perso-preview__name">{customName.trim().toUpperCase() || " "}</span>
                    <span className="perso-preview__number">{customNumber.trim() || " "}</span>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={spellingOk} onChange={(e) => setSpellingOk(e.target.checked)} />
                    <span>{t("product.spellingConfirm")}</span>
                  </label>
                  {attempted && !spellingOk && (
                    <p className="field__error" role="alert">
                      {t("errors.confirmSpelling")}
                    </p>
                  )}
                  <p className="text-xs text-muted">{t("product.customizationNote")}</p>
                </>
              )}
            </fieldset>
          )}

          {/* patch */}
          {availablePatches.length > 0 && (
            <fieldset className="field">
              <legend className="field__label">{t("product.patch")}</legend>
              <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
                <button type="button" className={`chip${patchId === "" ? " is-selected" : ""}`} aria-pressed={patchId === ""} onClick={() => setPatchId("")}>
                  {t("product.patchNone")}
                </button>
                {availablePatches.map((p) => (
                  <button key={p.id} type="button" className={`chip${patchId === p.id ? " is-selected" : ""}`} aria-pressed={patchId === p.id} onClick={() => setPatchId(p.id)}>
                    {L(p.name)} <bdi>+₪{p.priceIls}</bdi>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {/* quantity */}
          <div className="field">
            <span className="field__label" id="qty-label">
              {t("product.quantity")}
            </span>
            <div className="qty" role="group" aria-labelledby="qty-label">
              <button type="button" aria-label="−" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1}>
                <IconMinus size={15} />
              </button>
              <span aria-live="polite">{quantity}</span>
              <button type="button" aria-label="+" onClick={() => setQuantity((q) => Math.min(10, q + 1))}>
                <IconPlus size={15} />
              </button>
            </div>
          </div>

          {/* size-chart confirmation before checkout (spec §11) */}
          <label className="check">
            <input type="checkbox" checked={sizeOk} onChange={(e) => setSizeOk(e.target.checked)} />
            <span>{t("sizeGuide.confirmBeforeCheckout")}</span>
          </label>
          {attempted && !sizeOk && (
            <p className="field__error" role="alert">
              {t("errors.confirmSize")}
            </p>
          )}

          {/* totals + actions */}
          <div className="product-actions" id="buy-actions">
            <div className="row row--between">
              <span className="text-sm text-muted">{t("product.priceTotal")}</span>
              {priced && <Price ils={priced.lineTotalIls} className="product-price" />}
            </div>
            {unavailable ? (
              <p className="badge badge--muted">{t("product.temporarilyUnavailable")}</p>
            ) : (
              <>
                <button type="button" className="btn btn--gold btn--lg btn--block" onClick={buyNow}>
                  {product.status === "made_to_order" ? t("product.reserveJersey") : t("product.buyNow")}
                </button>
                <button type="button" className="btn btn--dark btn--lg btn--block" onClick={addToCart}>
                  <IconBag size={18} /> {t("product.addToCart")}
                </button>
                {product.status === "made_to_order" && <p className="text-xs text-muted">{t("product.reserveNote")}</p>}
              </>
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                aria-pressed={wishlist.has(product.slug)}
                onClick={() => wishlist.toggle(product.slug)}
              >
                <IconHeart size={16} filled={wishlist.has(product.slug)} /> {wishlist.has(product.slug) ? t("product.wishlistRemove") : t("product.wishlistAdd")}
              </button>
              {settings?.whatsappNumber && (
                <a
                  className="btn btn--outline btn--sm"
                  href={whatsappLink(settings.whatsappNumber, locale, {
                    intent: "order",
                    productTitle: title,
                    productUrl: `${location.origin}/${locale}/product/${slug}`,
                    size: size || undefined,
                    version: version ? versionLabel(version) : undefined,
                    personalization: personalized ? { name: customName, number: customNumber } : undefined,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => track("whatsapp_click", { placement: "product" })}
                >
                  <IconWhatsApp size={16} /> {t("product.whatsappAsk")}
                </a>
              )}
            </div>
          </div>

          {/* delivery + policy notes */}
          <div className="card stack--sm stack" style={{ padding: "var(--sp-4)" }}>
            <p className="text-sm">{settings ? L(settings.supplierEtaText) : t("product.deliveryNote")}</p>
            <p className="text-sm text-muted">
              {t("product.policyNote")}{" "}
              <Link to={`/${locale}/policies/returns`} className="text-gold">
                {t("product.policyLinkText")}
              </Link>
            </p>
          </div>

          {/* details + care */}
          <div className="accordion">
            <AccordionItem title={t("product.detailsTitle")}>{L(product.details)}</AccordionItem>
            <AccordionItem title={t("product.careTitle")}>{t("product.careBody")}</AccordionItem>
          </div>
        </div>
      </div>

      <hr className="divider" style={{ marginBlock: "var(--sp-12)" }} />
      <ReviewsSection productSlug={product.slug} />

      {related.length > 0 && (
        <section className="mt-8 stack stack--lg" aria-labelledby="related-heading">
          <h2 id="related-heading" className="section__title" style={{ fontSize: "var(--fs-2xl)" }}>
            {t("product.relatedTitle")}
          </h2>
          <div className="prod-grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* sticky mobile buy bar — offsets the WhatsApp float (spec §21/§29) */}
      {!unavailable && (
        <div className="sticky-buy show-sm-only">
          {priced && <Price ils={priced.lineTotalIls} />}
          <button type="button" className="btn btn--gold" onClick={buyNow}>
            {product.status === "made_to_order" ? t("product.reserveJersey") : t("product.buyNow")}
          </button>
        </div>
      )}
    </main>
  );
}

function AccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`accordion__item${open ? " is-open" : ""}`}>
      <button type="button" className="accordion__trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {title}
        <IconPlus size={18} className="accordion__icon" />
      </button>
      {open && <div className="accordion__panel">{children}</div>}
    </div>
  );
}
