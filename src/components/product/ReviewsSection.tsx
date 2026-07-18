import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { dataService } from "../../services/index.ts";
import { track } from "../../lib/analytics.ts";
import type { Review } from "../../services/types.ts";
import { Stars } from "../ui/bits.tsx";
import { IconCheck, IconStar } from "../ui/Icons.tsx";
import { useToast } from "../../services/store.tsx";
import { s } from "../../lib/schema.ts";

const reviewSchema = s.object({
  displayName: s.string().trim().min(2).max(40),
  title: s.string().trim().min(2).max(80),
  body: s.string().trim().min(10).max(1200),
});

export function ReviewsSection({ productSlug, heading }: { productSlug?: string; heading?: string }) {
  const { locale, t } = useI18n();
  const toast = useToast();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [fields, setFields] = useState({ displayName: "", title: "", body: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;
    dataService()
      .listApprovedReviews(productSlug)
      .then((r) => alive && setReviews(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [productSlug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewSchema.safeParse(fields);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.issues) map[issue.path] = issue.message;
      setErrors(map);
      return;
    }
    setErrors({});
    const res = await dataService().submitReview({
      productSlug,
      rating: rating as Review["rating"],
      title: parsed.data.title,
      body: parsed.data.body,
      displayName: parsed.data.displayName,
      locale,
      photo,
    });
    if (res.ok) {
      setSubmitted(true);
      track("review_interaction", { action: "submitted" });
      toast.push(t("reviews.pendingNote"));
    } else {
      toast.push(res.error ?? t("common.error"), "error");
    }
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
      toast.push(t("reviews.photoInvalid"), "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <section className="stack stack--lg" aria-labelledby="reviews-heading">
      <div className="row row--between row--wrap">
        <h2 id="reviews-heading" className="section__title" style={{ fontSize: "var(--fs-2xl)" }}>
          {heading ?? t("product.reviewsTitle")} {reviews.length > 0 && <span className="text-muted">({reviews.length})</span>}
        </h2>
        {!submitted && (
          <button type="button" className="btn btn--outline btn--sm" aria-expanded={formOpen} onClick={() => setFormOpen((o) => !o)}>
            {t("reviews.writeReview")}
          </button>
        )}
      </div>

      {formOpen && !submitted && (
        <form className="card stack" onSubmit={submit} noValidate>
          <div className="field">
            <span className="field__label">{t("reviews.rating")}</span>
            <div className="row" role="radiogroup" aria-label={t("reviews.rating")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n}/5`}
                  className="icon-btn"
                  style={{ width: 34, height: 34, color: n <= rating ? "var(--gold-500)" : "var(--gray-300)" }}
                  onClick={() => setRating(n)}
                >
                  <IconStar filled size={20} />
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <Field id="rv-name" label={t("reviews.displayName")} error={errors.displayName}>
              <input id="rv-name" className="input" value={fields.displayName} aria-invalid={!!errors.displayName} onChange={(e) => setFields((f) => ({ ...f, displayName: e.target.value }))} />
            </Field>
            <Field id="rv-title" label={t("reviews.reviewTitle")} error={errors.title}>
              <input id="rv-title" className="input" value={fields.title} aria-invalid={!!errors.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} />
            </Field>
          </div>
          <Field id="rv-body" label={t("reviews.yourReview")} error={errors.body}>
            <textarea id="rv-body" className="textarea" value={fields.body} aria-invalid={!!errors.body} onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))} />
          </Field>
          <Field id="rv-photo" label={t("reviews.photoLabel")}>
            <input id="rv-photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} className="input" />
          </Field>
          <p className="text-xs text-muted">{t("reviews.moderationNote")}</p>
          <button type="submit" className="btn btn--gold" style={{ alignSelf: "flex-start" }}>
            {t("reviews.submit")}
          </button>
        </form>
      )}

      {submitted && <p className="badge badge--ok">{t("reviews.pendingNote")}</p>}

      {reviews.length === 0 ? (
        <p className="text-muted">{t("reviews.empty")}</p>
      ) : (
        <div className="grid-3">
          {reviews.map((r) => (
            <blockquote key={r.id} className="review-card" dir={r.locale === "en" ? "ltr" : "rtl"} lang={r.locale}>
              <Stars rating={r.rating} />
              <p style={{ fontWeight: 700, fontSize: "var(--fs-sm)" }}>{r.title}</p>
              <p className="review-card__body">{r.body}</p>
              {r.photo && <img src={r.photo} alt={t("reviews.photoAlt", { name: r.displayName })} className="review-card__photo" loading="lazy" />}
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
      )}
    </section>
  );
}

export function Field({ id, label, error, hint, children, required }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
