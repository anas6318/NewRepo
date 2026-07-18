/**
 * Root application: top-level routing between the three storefront language
 * experiences (/ar, /he, /en), the admin dashboard (/admin) and the root
 * language-selection page (/).
 */
import { RouterProvider, RouteSwitch, Redirect, type RouteDef } from "./lib/router.tsx";
import { detectPreferredLocale, isLocale } from "./lib/i18n/index.tsx";
import { LanguageSelect } from "./pages/LanguageSelect.tsx";
import { StorefrontApp } from "./pages/storefront/StorefrontApp.tsx";
import { AdminApp } from "./pages/admin/AdminApp.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";

const routes: RouteDef[] = [
  { path: "/", element: () => <LanguageSelect /> },
  { path: "/admin", element: () => <AdminApp /> },
  { path: "/admin/*", element: () => <AdminApp /> },
  { path: "/:locale", element: (p) => <LocaleGate seg={p.locale ?? ""} /> },
  { path: "/:locale/*", element: (p) => <LocaleGate seg={p.locale ?? ""} /> },
];

function LocaleGate({ seg }: { seg: string }) {
  if (isLocale(seg)) return <StorefrontApp locale={seg} />;
  // Unknown first segment → send to the preferred language's 404 handling.
  return <Redirect to={`/${detectPreferredLocale()}/not-found`} />;
}

export function App() {
  return (
    <ErrorBoundary>
      <RouterProvider>
        <RouteSwitch routes={routes} fallback={<Redirect to="/" />} />
      </RouterProvider>
    </ErrorBoundary>
  );
}
