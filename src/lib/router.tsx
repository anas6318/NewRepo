/**
 * Minimal client-side router (React bindings over router-core.ts).
 *
 * This project intentionally ships a small local router instead of the
 * react-router-dom package: the delivery environment had no npm registry
 * access, and a runnable, testable application was a hard requirement. The
 * API mirrors the react-router mental model (Link, useNavigate, useParams,
 * useSearchParams), so migrating to react-router-dom later is mechanical —
 * see docs/architecture.md §"Router decision".
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { matchBest } from "./router-core.ts";

export interface Location {
  pathname: string;
  search: string;
  hash: string;
}

interface RouterContextValue {
  location: Location;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});

function readLocation(): Location {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(readLocation);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.assign(to);
      return;
    }
    if (opts?.replace) {
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } else {
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
    }
    setLocation(readLocation());
    if (!url.hash) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside <RouterProvider>");
  return ctx;
}

export function useLocation(): Location {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function useParams(): Record<string, string> {
  return useContext(ParamsContext);
}

export function useSearchParams(): [URLSearchParams, (next: URLSearchParams, opts?: { replace?: boolean }) => void] {
  const { location, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback(
    (next: URLSearchParams, opts?: { replace?: boolean }) => {
      const qs = next.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: opts?.replace ?? true });
    },
    [location.pathname, navigate],
  );
  return [params, setParams];
}

export interface RouteDef {
  path: string;
  element: (params: Record<string, string>) => ReactNode;
}

/** Renders the best-matching route (most specific wins), or the fallback. */
export function RouteSwitch({ routes, fallback }: { routes: RouteDef[]; fallback: ReactNode }) {
  const { location } = useRouter();
  const best = matchBest(
    routes.map((r) => r.path),
    location.pathname,
  );
  if (!best) return <>{fallback}</>;
  const route = routes.find((r) => r.path === best.pattern);
  if (!route) return <>{fallback}</>;
  return <ParamsContext.Provider value={best.match.params}>{route.element(best.match.params)}</ParamsContext.Provider>;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  replace?: boolean;
};

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      (rest.target && rest.target !== "_self")
    ) {
      return;
    }
    e.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function NavLink({
  to,
  exact,
  className,
  activeClassName = "is-active",
  ...rest
}: LinkProps & { exact?: boolean; activeClassName?: string }) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const cls = [className, active ? activeClassName : ""].filter(Boolean).join(" ");
  return <Link to={to} className={cls} aria-current={active ? "page" : undefined} {...rest} />;
}

/** Declarative redirect. */
export function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}
