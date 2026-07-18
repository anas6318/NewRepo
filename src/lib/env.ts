/**
 * Single source of truth for runtime configuration.
 * Reads Vite's `import.meta.env` when present, with an optional
 * `window.__CROWNED_ENV__` runtime override (used by the sandbox preview and
 * useful for containerized deploys where env is injected at serve time).
 *
 * SECURITY: only VITE_-prefixed, public values ever appear here. Secrets
 * (service role key, payment keys, Google credentials) live exclusively in
 * Supabase Edge Function secrets — see .env.example.
 */

declare global {
  interface Window {
    __CROWNED_ENV__?: Record<string, string | undefined>;
  }
}

function readRaw(): Record<string, string | undefined> {
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const fromWindow = typeof window !== "undefined" ? (window.__CROWNED_ENV__ ?? {}) : {};
  return { ...fromVite, ...fromWindow };
}

export interface AppConfig {
  /** True when the app runs on local, clearly-labeled demo data. */
  demoMode: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
  whatsappNumber: string;
  instagramUsername: string;
  ga4Id: string;
  metaPixelId: string;
  tiktokPixelId: string;
  internationalMode: "disabled" | "waitlist" | "enabled";
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const raw = readRaw();
  const supabaseUrl = raw.VITE_SUPABASE_URL?.trim() ?? "";
  const explicitDemo = raw.VITE_DEMO_MODE?.trim().toLowerCase();
  const intl = raw.VITE_INTERNATIONAL_MODE?.trim().toLowerCase();
  cached = {
    // Demo mode runs ONLY when no Supabase project is configured (so the
    // standalone preview always works). A configured Supabase URL
    // hard-disables demo mode — even VITE_DEMO_MODE=true cannot re-enable
    // demo data/credentials in a production configuration.
    demoMode: supabaseUrl === "" && explicitDemo !== "false",
    supabaseUrl,
    supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
    siteUrl: raw.VITE_SITE_URL?.trim() || "https://example.com",
    whatsappNumber: raw.VITE_WHATSAPP_NUMBER?.trim() ?? "",
    instagramUsername: raw.VITE_INSTAGRAM_USERNAME?.trim() ?? "",
    ga4Id: raw.VITE_GA4_ID?.trim() ?? "",
    metaPixelId: raw.VITE_META_PIXEL_ID?.trim() ?? "",
    tiktokPixelId: raw.VITE_TIKTOK_PIXEL_ID?.trim() ?? "",
    internationalMode: intl === "enabled" ? "enabled" : intl === "waitlist" ? "waitlist" : "disabled",
  };
  return cached;
}

/** Test seam. */
export function resetConfigForTests(): void {
  cached = null;
}
