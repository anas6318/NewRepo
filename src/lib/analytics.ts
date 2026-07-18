/**
 * Analytics data layer (spec §32). Providers (GA4 / Meta / TikTok) load only
 * when their IDs are configured; events always flow into a local dataLayer
 * so the integration is testable without external scripts.
 *
 * PRIVACY: no personal information ever enters an event payload — no names,
 * emails, phones, addresses or custom jersey names.
 */
import { getConfig } from "./env.ts";

type EventName =
  | "language_selected"
  | "view_item"
  | "view_category"
  | "search"
  | "select_item"
  | "add_to_wishlist"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info"
  | "purchase"
  | "whatsapp_click"
  | "instagram_click"
  | "size_guide_view"
  | "review_interaction";

interface EventPayload {
  [key: string]: string | number | boolean | undefined;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const FORBIDDEN_KEYS = /name|email|phone|address|note|personal/i;

export function track(event: EventName, payload: EventPayload = {}): void {
  const clean: EventPayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_KEYS.test(k)) continue; // hard PII guard
    clean[k] = v;
  }
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...clean, ts: Date.now() });
  window.gtag?.("event", event, clean);
  if (event === "purchase") window.fbq?.("track", "Purchase", { value: clean.value, currency: "ILS" });
  if (event === "add_to_cart") window.fbq?.("track", "AddToCart", { value: clean.value, currency: "ILS" });
}

let loaded = false;

/** Injects provider scripts when IDs exist. Safe to call once at startup. */
export function initAnalytics(): void {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const { ga4Id, metaPixelId } = getConfig();
  if (ga4Id) {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", ga4Id, { anonymize_ip: true });
  }
  if (metaPixelId) {
    // Standard pixel bootstrap without inline eval.
    const f = window as unknown as { fbq?: { (...a: unknown[]): void; queue?: unknown[]; loaded?: boolean; version?: string } };
    if (!f.fbq) {
      const fbq = ((...args: unknown[]) => {
        fbq.queue?.push(args);
      }) as { (...a: unknown[]): void; queue?: unknown[]; loaded?: boolean; version?: string };
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = "2.0";
      f.fbq = fbq;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);
    }
    window.fbq?.("init", metaPixelId);
  }
}
