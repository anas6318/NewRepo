/**
 * Admin dashboard (spec §26). The admin UI itself is English-only (a
 * documented scope decision — see docs/architecture.md); all CUSTOMER-facing
 * content it manages is fully trilingual via the translation tabs.
 *
 * Authorization: the UI guard here is convenience only — every mutation is
 * re-authorized in the data layer (demo: requireStaff(); supabase: RLS +
 * edge-function role checks). Hidden links are never the security boundary.
 */
import { useEffect, useState } from "react";
import { Link, NavLink, RouteSwitch, useNavigate, type RouteDef } from "../../lib/router.tsx";
import { LocaleProvider } from "../../lib/i18n/index.tsx";
import { StoreProviders, useSession } from "../../services/store.tsx";
import { dataService, isDemoMode } from "../../services/index.ts";
import { DEMO_CREDENTIALS } from "../../services/demo/seed-data.ts";
import type { Customer } from "../../services/types.ts";
import { AdminDashboard } from "./AdminDashboard.tsx";
import { AdminProducts, AdminProductEdit, AdminImport } from "./AdminCatalog.tsx";
import { AdminOrders, AdminOrderView } from "./AdminOrders.tsx";
import { AdminCustomers, AdminReviews } from "./AdminPeople.tsx";
import { AdminShipping, AdminPayments, AdminTranslations, AdminSettings, AdminAudit } from "./AdminConfig.tsx";

export function AdminApp() {
  return (
    <LocaleProvider locale="en">
      <StoreProviders>
        <AdminGate />
      </StoreProviders>
    </LocaleProvider>
  );
}

const NAV: { path: string; label: string; roles?: Customer["role"][] }[] = [
  { path: "/admin", label: "Dashboard" },
  { path: "/admin/products", label: "Products" },
  { path: "/admin/imports", label: "Supplier import" },
  { path: "/admin/orders", label: "Orders" },
  { path: "/admin/customers", label: "Customers" },
  { path: "/admin/reviews", label: "Reviews" },
  { path: "/admin/shipping", label: "Shipping" },
  { path: "/admin/payments", label: "Payments", roles: ["owner", "admin"] },
  { path: "/admin/translations", label: "Translations" },
  { path: "/admin/settings", label: "Settings", roles: ["owner", "admin"] },
  { path: "/admin/audit", label: "Audit log", roles: ["owner", "admin"] },
];

function AdminGate() {
  const { customer, loading } = useSession();

  if (loading) {
    return (
      <main id="main" className="container section" aria-busy="true">
        <div className="skeleton" style={{ height: 200, borderRadius: "var(--r-md)" }} />
      </main>
    );
  }
  if (!customer || customer.role === "customer") return <AdminLogin />;
  return <AdminShell customer={customer} />;
}

function AdminLogin() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Admin login · CROWNED";
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await dataService().login(email, password);
    setBusy(false);
    if (!res.ok || !res.customer || res.customer.role === "customer") {
      setError("Invalid credentials or insufficient permissions.");
      await dataService().logout();
      return;
    }
    await refresh();
  };

  return (
    <main id="main" className="theme-dark" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--sp-5)" }}>
      <div style={{ width: "100%", maxWidth: 400 }} className="stack">
        <img src="/brand/logo-white.svg" alt="CROWNED" width={170} height={43} style={{ alignSelf: "center" }} />
        <h1 className="center-text" style={{ fontSize: "var(--fs-xl)" }}>
          Admin login
        </h1>
        {isDemoMode() && (
          <div className="card stack--sm stack" style={{ background: "var(--ink-850)", borderColor: "var(--gold-700)" }}>
            <span className="badge badge--demo">Demo mode</span>
            <p className="text-xs num" dir="ltr">
              {DEMO_CREDENTIALS.admin.email} / {DEMO_CREDENTIALS.admin.password}
            </p>
          </div>
        )}
        <form className="stack" onSubmit={submit}>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <button type="submit" className="btn btn--gold btn--block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <Link to="/en" className="text-xs text-muted center-text">
          ← Back to storefront
        </Link>
      </div>
    </main>
  );
}

function AdminShell({ customer }: { customer: Customer }) {
  const navigate = useNavigate();

  const can = (item: (typeof NAV)[number]) => !item.roles || item.roles.includes(customer.role);

  const routes: RouteDef[] = [
    { path: "/admin", element: () => <AdminDashboard /> },
    { path: "/admin/products", element: () => <AdminProducts /> },
    { path: "/admin/products/:id", element: (p) => <AdminProductEdit id={p.id ?? ""} /> },
    { path: "/admin/imports", element: () => <AdminImport /> },
    { path: "/admin/orders", element: () => <AdminOrders /> },
    { path: "/admin/orders/:orderNumber", element: (p) => <AdminOrderView orderNumber={p.orderNumber ?? ""} /> },
    { path: "/admin/customers", element: () => <AdminCustomers /> },
    { path: "/admin/reviews", element: () => <AdminReviews /> },
    { path: "/admin/shipping", element: () => <AdminShipping /> },
    { path: "/admin/payments", element: () => (customer.role === "owner" || customer.role === "admin" ? <AdminPayments /> : <Forbidden />) },
    { path: "/admin/translations", element: () => <AdminTranslations /> },
    { path: "/admin/settings", element: () => (customer.role === "owner" || customer.role === "admin" ? <AdminSettings /> : <Forbidden />) },
    { path: "/admin/audit", element: () => (customer.role === "owner" || customer.role === "admin" ? <AdminAudit /> : <Forbidden />) },
  ];

  return (
    <div className="admin">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {isDemoMode() && <p className="demo-banner">DEMO MODE — local development data only. Nothing here touches real services or real money.</p>}
      <div className="admin__frame">
        <aside className="admin__sidebar theme-dark">
          <Link to="/admin" className="admin__logo">
            <img src="/brand/logo-white.svg" alt="CROWNED admin" width={130} height={33} />
          </Link>
          <nav className="admin__nav" aria-label="Admin">
            {NAV.filter(can).map((item) => (
              <NavLink key={item.path} to={item.path} exact={item.path === "/admin"} className="admin__navlink">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="admin__foot">
            <p className="text-xs text-muted">
              {customer.name}
              <br />
              <span className="badge badge--gold">{customer.role}</span>
            </p>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                void dataService()
                  .logout()
                  .then(() => navigate("/en"));
              }}
            >
              Log out
            </button>
          </div>
        </aside>
        <main id="main" className="admin__main">
          <RouteSwitch routes={routes} fallback={<Forbidden notFound />} />
        </main>
      </div>
    </div>
  );
}

function Forbidden({ notFound }: { notFound?: boolean }) {
  return (
    <div className="empty-state">
      <h1 className="section__title">{notFound ? "Page not found" : "Insufficient permissions"}</h1>
      <p className="text-muted">{notFound ? "This admin page does not exist." : "Your role does not allow access to this area."}</p>
      <Link to="/admin" className="btn btn--dark">
        Dashboard
      </Link>
    </div>
  );
}
