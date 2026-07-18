/**
 * Client-side stores: cart, wishlist, session, settings, toasts.
 * Cart/wishlist persist in localStorage; the account wishlist merges on
 * login (spec §18). All money math delegates to lib/pricing + lib/delivery.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CartLine, Customer, Product, ShippingZone, StoreSettings } from "./types.ts";
import { dataService } from "./index.ts";
import { cartSubtotal } from "../lib/pricing.ts";
import { evaluateFreeDelivery, freeDeliveryMessage, type FreeDeliveryResult } from "../lib/delivery.ts";

/* ── Toasts ──────────────────────────────────────────────────────────────── */
interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const ToastContext = createContext<{ toasts: Toast[]; push: (text: string, kind?: Toast["kind"]) => void }>({
  toasts: [],
  push: () => undefined,
});

export function useToast() {
  return useContext(ToastContext);
}

/* ── Cart ────────────────────────────────────────────────────────────────── */
const CART_KEY = "crowned_cart_v1";

export interface CartState {
  lines: CartLine[];
  count: number;
  subtotalIls: number;
  freeDelivery: FreeDeliveryResult;
  fdMessage: ReturnType<typeof freeDeliveryMessage>;
  minItems: number;
  add: (line: Omit<CartLine, "key">) => void;
  updateQty: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const CartContext = createContext<CartState | null>(null);

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) return JSON.parse(raw) as CartLine[];
  } catch {
    /* ignore */
  }
  return [];
}

export function lineKey(line: Omit<CartLine, "key">): string {
  return [line.productId, line.version ?? "", line.sleeve ?? "", line.size, line.personalization?.name ?? "", line.personalization?.number ?? "", line.patchId ?? ""].join("|");
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside provider");
  return ctx;
}

/* ── Wishlist ────────────────────────────────────────────────────────────── */
const WISH_KEY = "crowned_wishlist_v1";

interface WishlistState {
  slugs: string[];
  has: (slug: string) => boolean;
  toggle: (slug: string) => void;
}

const WishlistContext = createContext<WishlistState | null>(null);

export function useWishlist(): WishlistState {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist outside provider");
  return ctx;
}

/* ── Session ─────────────────────────────────────────────────────────────── */
interface SessionState {
  customer: Customer | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}

/* ── Settings ────────────────────────────────────────────────────────────── */
interface SettingsState {
  settings: StoreSettings | null;
  zones: ShippingZone[];
}

const SettingsContext = createContext<SettingsState>({ settings: null, zones: [] });

export function useSettings(): SettingsState {
  return useContext(SettingsContext);
}

/* ── Provider composition ────────────────────────────────────────────────── */
export function StoreProviders({ children }: { children: ReactNode }) {
  /* toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  /* settings */
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [zones, setZones] = useState<ShippingZone[]>([]);
  useEffect(() => {
    let alive = true;
    dataService()
      .getSettings()
      .then((s) => alive && setSettings(s))
      .catch((e) => console.error("[crowned] settings load failed:", e));
    dataService()
      .listZones()
      .then((z) => alive && setZones(z))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* session */
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const refreshSession = useCallback(async () => {
    try {
      const s = await dataService().session();
      setCustomer(s.customer);
    } finally {
      setSessionLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);
  const logout = useCallback(async () => {
    await dataService().logout();
    setCustomer(null);
  }, []);

  /* cart */
  const [lines, setLines] = useState<CartLine[]>(loadCart);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines]);

  const minItems = settings?.freeDeliveryMinItems ?? 3;
  const cart = useMemo<CartState>(() => {
    const subtotalIls = cartSubtotal(lines.map((l) => ({ lineTotalIls: l.unitPriceIls * l.quantity })));
    const fd = evaluateFreeDelivery(
      lines.map((l) => ({ countsForFreeDelivery: l.qualifiesForFreeDelivery, quantity: l.quantity })),
      minItems,
    );
    return {
      lines,
      count: lines.reduce((s, l) => s + l.quantity, 0),
      subtotalIls,
      freeDelivery: fd,
      fdMessage: freeDeliveryMessage(fd),
      minItems,
      add: (line) => {
        const key = lineKey(line);
        setLines((prev) => {
          const existing = prev.find((l) => l.key === key);
          if (existing) {
            return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l));
          }
          return [...prev, { ...line, key }];
        });
        setDrawerOpen(true);
      },
      updateQty: (key, quantity) => {
        setLines((prev) => (quantity < 1 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity } : l))));
      },
      remove: (key) => setLines((prev) => prev.filter((l) => l.key !== key)),
      clear: () => setLines([]),
      drawerOpen,
      setDrawerOpen,
    };
  }, [lines, drawerOpen, minItems]);

  /* wishlist */
  const [wishSlugs, setWishSlugs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WISH_KEY);
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      /* ignore */
    }
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem(WISH_KEY, JSON.stringify(wishSlugs));
    } catch {
      /* ignore */
    }
  }, [wishSlugs]);
  // Merge guest wishlist into the account on login (spec §18).
  useEffect(() => {
    if (!customer) return;
    let alive = true;
    dataService()
      .getWishlist(customer.id)
      .then((remote) => {
        if (!alive) return;
        const merged = [...new Set([...remote, ...wishSlugs])];
        setWishSlugs(merged);
        if (merged.length !== remote.length) void dataService().setWishlist(customer.id, merged);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- merge once per login
  }, [customer?.id]);

  const wishlist = useMemo<WishlistState>(
    () => ({
      slugs: wishSlugs,
      has: (slug) => wishSlugs.includes(slug),
      toggle: (slug) => {
        setWishSlugs((prev) => {
          const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
          if (customer) void dataService().setWishlist(customer.id, next);
          return next;
        });
      },
    }),
    [wishSlugs, customer],
  );

  const session = useMemo<SessionState>(
    () => ({ customer, loading: sessionLoading, refresh: refreshSession, logout }),
    [customer, sessionLoading, refreshSession, logout],
  );

  return (
    <ToastContext.Provider value={{ toasts, push: pushToast }}>
      <SettingsContext.Provider value={{ settings, zones }}>
        <SessionContext.Provider value={session}>
          <CartContext.Provider value={cart}>
            <WishlistContext.Provider value={wishlist}>
              {children}
              <ToastViewport toasts={toasts} />
            </WishlistContext.Provider>
          </CartContext.Provider>
        </SessionContext.Provider>
      </SettingsContext.Provider>
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === "error" ? " toast--error" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Builds a cart line from a configured product (pricing delegated). */
export function buildCartLine(
  product: Product,
  opts: {
    version?: CartLine["version"];
    sleeve?: CartLine["sleeve"];
    size: string;
    personalization?: CartLine["personalization"];
    patchId?: string;
    patchName?: CartLine["patchName"];
    unitPriceIls: number;
    quantity: number;
  },
): Omit<CartLine, "key"> {
  return {
    productId: product.id,
    slug: product.slug,
    title: product.name,
    image: product.images[0]?.src ?? "",
    version: opts.version,
    sleeve: opts.sleeve,
    size: opts.size,
    personalization: opts.personalization,
    patchId: opts.patchId,
    patchName: opts.patchName,
    unitPriceIls: opts.unitPriceIls,
    quantity: opts.quantity,
    qualifiesForFreeDelivery: product.qualifiesForFreeDelivery,
    isDemo: product.isDemo,
  };
}
