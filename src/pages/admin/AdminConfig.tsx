/** Admin: shipping zones, payment settings, translations, store settings,
 * audit log (spec §26). */
import { useEffect, useState } from "react";
import { dataService, isDemoMode } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import { DemoDataService } from "../../services/demo/DemoDataService.ts";
import type { AuditEntry, LocalizedText, PaymentMethodSetting, ShippingZone, StoreSettings } from "../../services/types.ts";

function useSettingsEditor() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const toast = useToast();
  useEffect(() => {
    dataService()
      .getSettings()
      .then((s) => setSettings(structuredClone(s)))
      .catch((e) => toast.push(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async (next: StoreSettings) => {
    const res = await dataService().adminSaveSettings(next);
    toast.push(res.ok ? "Settings saved" : "Save failed", res.ok ? "info" : "error");
  };
  return { settings, setSettings, save };
}

function LField({ label, value, onChange, textarea }: { label: string; value: LocalizedText; onChange: (v: LocalizedText) => void; textarea?: boolean }) {
  const [lang, setLang] = useState<"en" | "ar" | "he">("en");
  const C = textarea ? "textarea" : "input";
  return (
    <div className="field">
      <div className="row row--between">
        <span className="field__label">{label}</span>
        <span className="row" style={{ gap: 4 }}>
          {(["en", "ar", "he"] as const).map((lng) => (
            <button key={lng} type="button" className={`chip${lang === lng ? " is-selected" : ""}`} style={{ minWidth: 0, padding: "2px 8px", fontSize: 11 }} onClick={() => setLang(lng)}>
              {lng}
            </button>
          ))}
        </span>
      </div>
      <C className={textarea ? "textarea" : "input"} dir={lang === "en" ? "ltr" : "rtl"} value={value[lang]} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [lang]: e.target.value })} />
    </div>
  );
}

export function AdminShipping() {
  const [zones, setZones] = useState<ShippingZone[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "Shipping · CROWNED admin";
    // Admin sees all zones incl. inactive — demo service exposes active only
    // via listZones, so read settings-level zones through the admin list.
    dataService()
      .listZones()
      .then((z) => setZones(structuredClone(z)))
      .catch((e) => toast.push(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!zones) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;

  const set = (i: number, patch: Partial<ShippingZone>) => setZones((z) => (z ? z.map((zone, idx) => (idx === i ? { ...zone, ...patch } : zone)) : z));

  const save = async () => {
    for (const z of zones) {
      if (z.priceIls < 35 || z.priceIls > 55) {
        toast.push(`Zone "${z.name.en}": delivery price must stay within ₪35–₪55 (spec §12).`, "error");
        return;
      }
    }
    const res = await dataService().adminSaveZones(zones);
    toast.push(res.ok ? "Zones saved" : "Save failed", res.ok ? "info" : "error");
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between row--wrap">
        <h1 className="section__title">Shipping zones</h1>
        <div className="row">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() =>
              setZones((z) => [
                ...(z ?? []),
                { id: `zone-${Date.now()}`, name: { ar: "", he: "", en: "New zone" }, priceIls: 40, etaDays: "3-5", active: true },
              ])
            }
          >
            + Add zone
          </button>
          <button type="button" className="btn btn--gold btn--sm" onClick={() => void save()}>
            Save all
          </button>
        </div>
      </div>
      <p className="text-sm text-muted">Local delivery fee must stay within ₪35–₪55. Free delivery applies automatically at 3+ qualifying items regardless of zone.</p>
      {zones.map((zone, i) => (
        <section key={zone.id} className="card stack" aria-label={zone.name.en}>
          <div className="row row--between row--wrap">
            <strong>{zone.name.en || "Unnamed zone"}</strong>
            <label className="check">
              <input type="checkbox" checked={zone.active} onChange={(e) => set(i, { active: e.target.checked })} /> Active
            </label>
          </div>
          <LField label="Zone name" value={zone.name} onChange={(name) => set(i, { name })} />
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Delivery price (₪35–₪55)</span>
              <input className="input num" type="number" min={35} max={55} value={zone.priceIls} onChange={(e) => set(i, { priceIls: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field__label">Local ETA (days)</span>
              <input className="input num" dir="ltr" value={zone.etaDays} onChange={(e) => set(i, { etaDays: e.target.value })} />
            </label>
          </div>
        </section>
      ))}
    </div>
  );
}

export function AdminPayments() {
  const { settings, setSettings, save } = useSettingsEditor();

  useEffect(() => {
    document.title = "Payments · CROWNED admin";
  }, []);

  if (!settings) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;

  const setMethod = (id: PaymentMethodSetting["id"], patch: Partial<PaymentMethodSetting>) =>
    setSettings({ ...settings, paymentMethods: settings.paymentMethods.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between">
        <h1 className="section__title">Payment settings</h1>
        <button type="button" className="btn btn--gold btn--sm" onClick={() => void save(settings)}>
          Save
        </button>
      </div>
      <p className="text-sm text-muted">
        A method appears at checkout only when it is <strong>enabled here AND configured with real credentials</strong> (server-side). Methods without
        credentials stay hidden in production — the store never fakes a payment integration. See docs/payment-setup.md for onboarding each provider.
      </p>
      {settings.paymentMethods.map((m) => (
        <section key={m.id} className="card stack--sm stack">
          <div className="row row--between row--wrap">
            <strong style={{ textTransform: "capitalize" }}>{m.id.replace("_", " ")}</strong>
            <div className="row row--wrap">
              <span className={`badge ${m.configured ? "badge--ok" : "badge--warn"}`}>{m.configured ? "credentials configured" : "no credentials"}</span>
              {m.testMode && <span className="badge badge--info">test mode</span>}
            </div>
          </div>
          <div className="row row--wrap">
            <label className="check">
              <input type="checkbox" checked={m.enabled} onChange={(e) => setMethod(m.id, { enabled: e.target.checked })} /> Enabled
            </label>
            <label className="check">
              <input type="checkbox" checked={m.testMode} onChange={(e) => setMethod(m.id, { testMode: e.target.checked })} /> Test mode
            </label>
          </div>
          {m.id === "bank_transfer" && <LField label="Bank transfer instructions (shown to customers)" value={settings.bankTransferInstructions} onChange={(v) => setSettings({ ...settings, bankTransferInstructions: v })} textarea />}
          {(m.id === "bit" || m.id === "paybox") && (
            <p className="text-xs" style={{ color: "var(--warn)" }}>
              Enable only with a real business integration — personal transfer links must not be presented as integrated payment methods (spec §14).
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

export function AdminTranslations() {
  const { settings, setSettings, save } = useSettingsEditor();

  useEffect(() => {
    document.title = "Translations · CROWNED admin";
  }, []);

  if (!settings) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between">
        <h1 className="section__title">Localization & policies</h1>
        <button type="button" className="btn btn--gold btn--sm" onClick={() => void save(settings)}>
          Save
        </button>
      </div>
      <p className="text-sm text-muted">
        Store-managed content in all three languages. Interface strings live in <code className="num">src/lib/i18n/*.json</code> (see
        docs/translation-review-checklist.md); everything below is stored content editable without a deploy.
      </p>
      <section className="card stack">
        <h2 className="drawer__title">Storefront texts</h2>
        <LField label="Announcement bar" value={settings.announcement} onChange={(v) => setSettings({ ...settings, announcement: v })} />
        <LField label="Delivery ETA text" value={settings.supplierEtaText} onChange={(v) => setSettings({ ...settings, supplierEtaText: v })} />
        <LField label="International note" value={settings.internationalNote} onChange={(v) => setSettings({ ...settings, internationalNote: v })} />
        <LField label="Non-affiliation disclosure" value={settings.nonAffiliationNote} onChange={(v) => setSettings({ ...settings, nonAffiliationNote: v })} textarea />
      </section>
      {(Object.keys(settings.policies) as (keyof StoreSettings["policies"])[]).map((slug) => (
        <section key={slug} className="card stack">
          <div className="row row--between row--wrap">
            <h2 className="drawer__title" style={{ textTransform: "capitalize" }}>
              {slug} policy
            </h2>
            {settings.policies[slug].needsLegalReview && <span className="badge badge--warn">needs legal review before launch</span>}
          </div>
          <LField label="Title" value={settings.policies[slug].title} onChange={(v) => setSettings({ ...settings, policies: { ...settings.policies, [slug]: { ...settings.policies[slug], title: v } } })} />
          <LField label="Body" value={settings.policies[slug].body} onChange={(v) => setSettings({ ...settings, policies: { ...settings.policies, [slug]: { ...settings.policies[slug], body: v } } })} textarea />
          <label className="check">
            <input
              type="checkbox"
              checked={settings.policies[slug].needsLegalReview}
              onChange={(e) => setSettings({ ...settings, policies: { ...settings.policies, [slug]: { ...settings.policies[slug], needsLegalReview: e.target.checked } } })}
            />
            Flag as needing legal review
          </label>
        </section>
      ))}
    </div>
  );
}

export function AdminSettings() {
  const { settings, setSettings, save } = useSettingsEditor();
  const toast = useToast();

  useEffect(() => {
    document.title = "Settings · CROWNED admin";
  }, []);

  if (!settings) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;

  return (
    <div className="stack stack--lg" style={{ maxWidth: 880 }}>
      <div className="row row--between">
        <h1 className="section__title">Store settings</h1>
        <button type="button" className="btn btn--gold btn--sm" onClick={() => void save(settings)}>
          Save
        </button>
      </div>
      <section className="card stack">
        <h2 className="drawer__title">Contact & social</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">WhatsApp number (international format)</span>
            <input className="input num" dir="ltr" value={settings.whatsappNumber} onChange={(e) => setSettings({ ...settings, whatsappNumber: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Instagram username</span>
            <input className="input num" dir="ltr" value={settings.instagramUsername} onChange={(e) => setSettings({ ...settings, instagramUsername: e.target.value })} />
          </label>
        </div>
      </section>
      <section className="card stack">
        <h2 className="drawer__title">Delivery</h2>
        <label className="field" style={{ maxWidth: 260 }}>
          <span className="field__label">Free delivery — min. qualifying items</span>
          <input className="input num" type="number" min={1} value={settings.freeDeliveryMinItems} onChange={(e) => setSettings({ ...settings, freeDeliveryMinItems: Math.max(1, Number(e.target.value)) })} />
          <span className="field__hint">Quantity-based, never cart-value-based.</span>
        </label>
      </section>
      <section className="card stack">
        <h2 className="drawer__title">International market</h2>
        <label className="field" style={{ maxWidth: 260 }}>
          <span className="field__label">Mode</span>
          <select className="select" value={settings.internationalMode} onChange={(e) => setSettings({ ...settings, internationalMode: e.target.value as StoreSettings["internationalMode"] })}>
            <option value="disabled">disabled</option>
            <option value="waitlist">waitlist</option>
            <option value="enabled">enabled (requires rates & policies)</option>
          </select>
          <span className="field__hint">Keep disabled/waitlist until international rates, countries and policies are confirmed (spec §5).</span>
        </label>
      </section>
      <section className="card stack">
        <h2 className="drawer__title">Legal entity (placeholders until supplied)</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Business name</span>
            <input className="input" value={settings.legalEntity.name} onChange={(e) => setSettings({ ...settings, legalEntity: { ...settings.legalEntity, name: e.target.value } })} />
          </label>
          <label className="field">
            <span className="field__label">Registration number (ע.מ / ח.פ)</span>
            <input className="input num" dir="ltr" value={settings.legalEntity.registrationNumber} onChange={(e) => setSettings({ ...settings, legalEntity: { ...settings.legalEntity, registrationNumber: e.target.value } })} />
          </label>
          <label className="field">
            <span className="field__label">Tax note</span>
            <input className="input" value={settings.legalEntity.taxNote} onChange={(e) => setSettings({ ...settings, legalEntity: { ...settings.legalEntity, taxNote: e.target.value } })} />
          </label>
        </div>
      </section>
      {isDemoMode() && (
        <section className="card stack--sm stack" style={{ borderColor: "var(--warn)" }}>
          <h2 className="drawer__title">Demo data</h2>
          <p className="text-sm text-muted">Reset the local demo database back to its seeded state (products, orders, reviews, settings).</p>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              const svc = dataService();
              if (svc instanceof DemoDataService) {
                svc.resetDemoData();
                toast.push("Demo data reset — reloading");
                setTimeout(() => window.location.reload(), 600);
              }
            }}
          >
            Reset demo data
          </button>
        </section>
      )}
    </div>
  );
}

export function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "Audit log · CROWNED admin";
    dataService()
      .adminAuditLog()
      .then(setEntries)
      .catch((e) => toast.push(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack stack--lg">
      <h1 className="section__title">Audit log</h1>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="num">{new Date(e.at).toLocaleString("en-GB")}</td>
                <td className="num">{e.actor}</td>
                <td>{e.action}</td>
                <td className="num">{e.target}</td>
                <td className="text-xs text-muted">{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
