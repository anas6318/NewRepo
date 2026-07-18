/** Small shared UI pieces: price, stars, badges, empty state, localized text. */
import type { ReactNode } from "react";
import { formatPrice, useI18n } from "../../lib/i18n/index.tsx";
import type { LocalizedText, ProductStatus } from "../../services/types.ts";
import { IconStar } from "./Icons.tsx";

export function useL() {
  const { locale } = useI18n();
  return (text: LocalizedText | undefined): string => text?.[locale] ?? text?.en ?? "";
}

export function Price({ ils, compareIls, className }: { ils: number; compareIls?: number; className?: string }) {
  return (
    <span className={`price ${className ?? ""}`}>
      <bdi className="price__amount">{formatPrice(ils)}</bdi>
      {compareIls !== undefined && compareIls > ils && <bdi className="price__compare">{formatPrice(compareIls)}</bdi>}
    </span>
  );
}

export function Stars({ rating, label }: { rating: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${rating}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} filled={i <= rating} className={i <= rating ? "" : "star--empty"} size={15} />
      ))}
    </span>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return <span className="badge badge--demo">{t("common.demoLabel")}</span>;
}

export function StatusBadge({ status }: { status: ProductStatus }) {
  const { t } = useI18n();
  if (status === "made_to_order") return <span className="badge badge--gold">{t("product.madeToOrder")}</span>;
  if (status === "available") return <span className="badge badge--ok">{t("product.availableToOrder")}</span>;
  if (status === "unavailable") return <span className="badge badge--muted">{t("product.temporarilyUnavailable")}</span>;
  return null;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h2 className="section__title" style={{ fontSize: "var(--fs-2xl)" }}>{title}</h2>
      {body && <p className="text-muted" style={{ maxWidth: "44ch" }}>{body}</p>}
      {action}
    </div>
  );
}

export function SectionHead({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="section__head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="section__title">{title}</h2>
        {sub && <p className="section__sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
