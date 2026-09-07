/**
 * Admin: Badge / patch options — the owner-managed global catalog.
 *
 * Everything a badge is (name, description, price, whether it is offered at
 * all, what order it appears in) is edited here and stored as data. Nothing
 * about badges is hard-coded in the storefront, so adding a new competition
 * badge or changing a price never requires a code change.
 *
 * Authorization is enforced in the data layer (demo: requireStaff();
 * supabase: RLS + the admin-actions edge function). This screen is
 * convenience only.
 */
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import type { BadgeOption, LocalizedText, Order } from "../../services/types.ts";
import { badgeDeletionBlockers, validateBadgeCatalog } from "../../lib/badges.ts";

const EMPTY_L: LocalizedText = { ar: "", he: "", en: "" };

function blankBadge(index: number): BadgeOption {
  return {
    id: `badge-${Date.now()}`,
    code: "",
    name: { ...EMPTY_L },
    priceIls: 0,
    active: false, // never offered to customers until deliberately enabled
    sortOrder: (index + 1) * 10,
  };
}

export function AdminBadges() {
  const [badges, setBadges] = useState<BadgeOption[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lang, setLang] = useState<"en" | "ar" | "he">("en");
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    document.title = "Badge / patch options · CROWNED admin";
    dataService()
      .adminListBadges()
      .then(setBadges)
      .catch((e) => {
        setBadges([]);
        toast.push(String(e), "error");
      });
    dataService()
      .adminListOrders()
      .then(setOrders)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = useMemo(() => (badges ? validateBadgeCatalog(badges) : []), [badges]);

  if (!badges) return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;

  const mutate = (next: BadgeOption[]) => {
    setBadges(next);
    setDirty(true);
  };
  const set = (index: number, patch: Partial<BadgeOption>) => mutate(badges.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const setL = (index: number, key: "name" | "description", value: string) =>
    mutate(badges.map((b, i) => (i === index ? { ...b, [key]: { ...(b[key] ?? EMPTY_L), [lang]: value } } : b)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= badges.length) return;
    const next = [...badges];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    mutate(next.map((b, i) => ({ ...b, sortOrder: (i + 1) * 10 })));
  };

  const remove = (index: number) => {
    const badge = badges[index];
    if (!badge) return;
    // Orders keep their own price/name snapshot, so removing an option never
    // rewrites history — but an option still referenced by a live order stays
    // in place so the owner can still see what it was.
    const blockers = badgeDeletionBlockers(badge.id, orders);
    if (blockers.length) {
      toast.push(`Cannot remove — used by ${blockers.length} order(s): ${blockers.slice(0, 3).join(", ")}. Disable it instead.`, "error");
      return;
    }
    mutate(badges.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (errors.length) {
      toast.push(errors[0]!, "error");
      return;
    }
    const res = await dataService().adminSaveBadges(badges);
    if (res.ok) {
      toast.push("Badge options saved");
      setDirty(false);
    } else toast.push(res.error ?? "Save failed", "error");
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between row--wrap">
        <div>
          <h1 className="section__title">Badge / patch options</h1>
          <p className="text-sm text-muted">
            The global catalog. Products opt in to individual options and can override the price — see a product's Badge / patch options section.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => mutate([...badges, blankBadge(badges.length)])}>
            Add option
          </button>
          <button type="button" className="btn btn--gold" onClick={() => void save()} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="card stack--sm stack" style={{ borderColor: "var(--danger)" }} role="alert">
          <strong className="text-sm">Fix before saving</strong>
          {errors.map((e) => (
            <p key={e} className="text-xs">
              {e}
            </p>
          ))}
        </div>
      )}

      <div className="row" role="group" aria-label="Translation language">
        {(["en", "ar", "he"] as const).map((l) => (
          <button key={l} type="button" className={`chip${lang === l ? " is-selected" : ""}`} aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {badges.length === 0 && <p className="text-muted">No badge options yet. Add one to offer badges on your products.</p>}

      {badges.map((badge, i) => (
        <section key={badge.id} className="card stack" aria-label={badge.name.en || badge.code || "New option"}>
          <div className="row row--between row--wrap">
            <h2 className="drawer__title">{badge.name.en || badge.code || "New option"}</h2>
            <div className="row">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${badge.code} up`}>
                ↑
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => move(i, 1)} disabled={i === badges.length - 1} aria-label={`Move ${badge.code} down`}>
                ↓
              </button>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field__label">Internal code</span>
              <input
                className="input num"
                dir="ltr"
                value={badge.code}
                onChange={(e) => set(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") })}
              />
              <span className="field__hint">Used in supplier imports. Never shown to customers.</span>
            </label>
            <label className="field">
              <span className="field__label">Default price adjustment (₪)</span>
              <input className="input num" type="number" min={0} step={1} value={badge.priceIls} onChange={(e) => set(i, { priceIls: Number(e.target.value) })} />
              <span className="field__hint">Used unless a product sets its own override.</span>
            </label>
            <label className="field">
              <span className="field__label">Customer-facing name ({lang.toUpperCase()})</span>
              <input
                className="input"
                dir={lang === "en" ? "ltr" : "rtl"}
                value={badge.name[lang]}
                onChange={(e) => setL(i, "name", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Internal supplier reference</span>
              <input className="input num" dir="ltr" value={badge.supplierReference ?? ""} onChange={(e) => set(i, { supplierReference: e.target.value || undefined })} />
              <span className="field__hint">Staff only — never sent to the storefront.</span>
            </label>
            <label className="field">
              <span className="field__label">Icon URL (optional)</span>
              <input className="input num" dir="ltr" value={badge.iconUrl ?? ""} onChange={(e) => set(i, { iconUrl: e.target.value || undefined })} />
            </label>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={badge.active} onChange={(e) => set(i, { active: e.target.checked })} />
              <span>Enabled globally</span>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Customer-facing description ({lang.toUpperCase()}, optional)</span>
            <textarea
              className="input"
              rows={2}
              dir={lang === "en" ? "ltr" : "rtl"}
              value={badge.description?.[lang] ?? ""}
              onChange={(e) => setL(i, "description", e.target.value)}
            />
          </label>

          <p className="text-xs text-muted">
            Customer preview ({lang.toUpperCase()}): <strong>{badge.name[lang] || "—"}</strong>{" "}
            <bdi dir="ltr">{badge.priceIls > 0 ? `+₪${badge.priceIls}` : "included"}</bdi>
            {!badge.active && " · not offered while disabled"}
          </p>
        </section>
      ))}
    </div>
  );
}
