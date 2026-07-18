/// <reference types="vite/client" />

// Minimal ImportMeta typing so the project type-checks both with the real
// `vite/client` types (when node_modules is installed) and without them
// (network-restricted verification environment).
interface ImportMetaEnv {
  readonly MODE?: string;
  readonly PROD?: boolean;
  readonly DEV?: boolean;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_WHATSAPP_NUMBER?: string;
  readonly VITE_INSTAGRAM_USERNAME?: string;
  readonly VITE_GA4_ID?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TIKTOK_PIXEL_ID?: string;
  readonly VITE_INTERNATIONAL_MODE?: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
