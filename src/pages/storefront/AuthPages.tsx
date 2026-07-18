import { useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { useSession } from "../../services/store.tsx";
import { DEMO_CREDENTIALS } from "../../services/demo/seed-data.ts";
import { Field } from "../../components/product/ReviewsSection.tsx";

export function LoginPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: t("account.loginTitle"), path: "/login", locale, noindex: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await dataService().login(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(t("account.invalidCredentials"));
      return;
    }
    await refresh();
    navigate(res.customer && res.customer.role !== "customer" ? "/admin" : `/${locale}/account`);
  };

  return (
    <main id="main" className="container--form container section">
      <h1 className="section__title mb-6">{t("account.loginTitle")}</h1>
      {isDemoMode() && (
        <div className="card stack--sm stack mb-6" style={{ borderColor: "var(--gold-500)" }}>
          <span className="badge badge--demo">{t("common.demoLabel")}</span>
          <p className="text-sm text-muted">{t("account.demoHint")}</p>
          <p className="text-xs num" dir="ltr">
            {DEMO_CREDENTIALS.customer.email} / {DEMO_CREDENTIALS.customer.password}
            <br />
            {DEMO_CREDENTIALS.admin.email} / {DEMO_CREDENTIALS.admin.password}
          </p>
        </div>
      )}
      <form className="card stack" onSubmit={submit} noValidate>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <Field id="lg-email" label={t("account.email")} required>
          <input id="lg-email" type="email" className="input" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="lg-pass" label={t("account.password")} required>
          <input id="lg-pass" type="password" className="input" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn--gold btn--block" disabled={busy}>
          {busy ? t("common.loading") : t("account.submitLogin")}
        </button>
        <p className="text-sm text-muted center-text">
          {t("account.noAccount")}{" "}
          <Link to={`/${locale}/register`} className="text-gold">
            {t("account.registerTitle")}
          </Link>
        </p>
      </form>
    </main>
  );
}

export function RegisterPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: t("account.registerTitle"), path: "/register", locale, noindex: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) {
      setError(t("account.registerValidation"));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await dataService().register(name, email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error === "email_taken" ? t("account.emailTaken") : res.error === "confirm_email" ? t("account.confirmEmail") : t("common.error"));
      return;
    }
    await refresh();
    navigate(`/${locale}/account`);
  };

  return (
    <main id="main" className="container--form container section">
      <h1 className="section__title mb-6">{t("account.registerTitle")}</h1>
      <form className="card stack" onSubmit={submit} noValidate>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <Field id="rg-name" label={t("account.fullName")} required>
          <input id="rg-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="rg-email" label={t("account.email")} required>
          <input id="rg-email" type="email" className="input" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="rg-pass" label={t("account.password")} required hint={t("account.passwordHint")}>
          <input id="rg-pass" type="password" className="input" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn--gold btn--block" disabled={busy}>
          {busy ? t("common.loading") : t("account.submitRegister")}
        </button>
        <p className="text-sm text-muted center-text">
          {t("account.haveAccount")}{" "}
          <Link to={`/${locale}/login`} className="text-gold">
            {t("account.loginTitle")}
          </Link>
        </p>
      </form>
    </main>
  );
}
