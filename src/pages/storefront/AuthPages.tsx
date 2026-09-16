import { useEffect, useState } from "react";
import { Link, useNavigate } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { usePageMeta } from "../../lib/seo.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { useSession } from "../../services/store.tsx";
import { DEMO_CREDENTIALS } from "../../services/demo/seed-data.ts";
import { Field } from "../../components/product/ReviewsSection.tsx";
import { PASSWORD_MIN_LENGTH, resetRedirectUrl, validateNewPassword } from "../../lib/auth-recovery.ts";

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
          <Link to={`/${locale}/forgot-password`} className="text-gold">
            {t("account.forgotPassword")}
          </Link>
        </p>
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

/**
 * Step 1 of password recovery: ask Supabase to email a recovery link.
 *
 * The response is IDENTICAL for every well-formed address — known, unknown,
 * rate-limited or network-failed — so this page cannot be used to discover
 * which emails have accounts. The only error it can show is a client-side
 * "that isn't a valid email address" check, which inspects the string's shape
 * and never contacts the server.
 */
export function ForgotPasswordPage() {
  const { locale, t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: t("account.forgotTitle"), path: "/forgot-password", locale, noindex: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError(t("account.forgotEmailInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    // Same-origin, same-locale reset page. The origin comes from the running
    // document, never from anything the visitor typed.
    const redirectTo = resetRedirectUrl(window.location.origin, locale);
    await dataService().requestPasswordReset(email.trim(), redirectTo);
    setBusy(false);
    setSent(true);
  };

  return (
    <main id="main" className="container--form container section">
      <h1 className="section__title mb-6">{t("account.forgotTitle")}</h1>
      {sent ? (
        <div className="card stack" data-testid="forgot-sent">
          <p role="status">{t("account.forgotSent")}</p>
          <Link to={`/${locale}/login`} className="btn btn--gold btn--block">
            {t("account.backToLogin")}
          </Link>
        </div>
      ) : (
        <form className="card stack" onSubmit={submit} noValidate>
          <p className="text-sm text-muted">{t("account.forgotIntro")}</p>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <Field id="fp-email" label={t("account.email")} required>
            <input id="fp-email" type="email" className="input" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn--gold btn--block" disabled={busy}>
            {busy ? t("common.loading") : t("account.forgotSubmit")}
          </button>
          <p className="text-sm text-muted center-text">
            <Link to={`/${locale}/login`} className="text-gold">
              {t("account.backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}

/**
 * Step 2: the page the emailed link lands on. Supabase appends the recovery
 * tokens as a URL fragment; they are handed straight to the data service and
 * the fragment is then wiped from the address bar so the token does not sit
 * in history or get copied out of the URL. Tokens are never logged.
 */
export function ResetPasswordPage() {
  const { locale, t } = useI18n();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: t("account.resetTitle"), path: "/reset-password", locale, noindex: true });

  useEffect(() => {
    let cancelled = false;
    const hash = window.location.hash;
    void dataService()
      .beginPasswordRecovery(hash)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          // Drop the tokens from the visible URL as soon as they are adopted.
          if (hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setReady(true);
        } else {
          setLinkError(res.error === "expired_link" ? t("account.resetLinkExpired") : t("account.resetLinkInvalid"));
        }
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount: the recovery link is only present on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem === "mismatch" ? t("account.resetMismatch") : t("account.resetTooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await dataService().updatePassword(password);
    setBusy(false);
    // Never keep the new password in component state longer than the request.
    setPassword("");
    setConfirm("");
    if (!res.ok) {
      setError(t("account.resetFailed"));
      return;
    }
    setDone(true);
  };

  return (
    <main id="main" className="container--form container section">
      <h1 className="section__title mb-6">{t("account.resetTitle")}</h1>

      {linkError && (
        <div className="card stack" data-testid="reset-link-error">
          <p className="field__error" role="alert">
            {linkError}
          </p>
          <Link to={`/${locale}/forgot-password`} className="btn btn--gold btn--block">
            {t("account.requestNewLink")}
          </Link>
        </div>
      )}

      {done && (
        <div className="card stack" data-testid="reset-success">
          <p role="status">{t("account.resetSuccess")}</p>
          <Link to={`/${locale}/login`} className="btn btn--gold btn--block">
            {t("account.goToLogin")}
          </Link>
        </div>
      )}

      {!linkError && !done && (
        <form className="card stack" onSubmit={submit} noValidate>
          <p className="text-sm text-muted">{t("account.resetIntro")}</p>
          {isDemoMode() && (
            <p className="text-sm text-muted">
              <span className="badge badge--demo">{t("common.demoLabel")}</span> {t("account.resetDemoHint")}
            </p>
          )}
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <Field id="rp-pass" label={t("account.newPassword")} required hint={t("account.passwordHint")}>
            <input
              id="rp-pass"
              type="password"
              className="input"
              dir="ltr"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field id="rp-confirm" label={t("account.confirmPassword")} required>
            <input
              id="rp-confirm"
              type="password"
              className="input"
              dir="ltr"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button type="submit" className="btn btn--gold btn--block" disabled={busy || !ready}>
            {busy ? t("common.loading") : t("account.resetSubmit")}
          </button>
          <p className="text-sm text-muted center-text">
            <Link to={`/${locale}/login`} className="text-gold">
              {t("account.backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
