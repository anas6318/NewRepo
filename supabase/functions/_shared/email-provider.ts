/**
 * The one place an email actually leaves this system.
 *
 * Both the owner order alert and the customer status emails go through
 * `deliverEmail`, so there is a single Resend call, a single timeout, a
 * single redaction rule and a single definition of what "sent" means.
 *
 * Honesty rule, inherited from _shared/helpers.ts `sendEmail`: "sent" means
 * a provider accepted the message. Console mode and missing configuration
 * are reported as "disabled"/"failed" — never as "sent".
 *
 * Runtime: written for Deno but with no top-level Deno access and an
 * injectable `fetch`, so the unit tests exercise this exact module under
 * Node. Keep it that way.
 */

export interface EmailProviderConfig {
  /** EMAIL_PROVIDER — "resend" sends for real; anything else is console. */
  provider: string;
  /** EMAIL_FROM — a sender verified on the provider. */
  from: string;
  /** RESEND_API_KEY — server-side only, never logged or echoed. */
  apiKey: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type DeliveryStatus = "sent" | "failed" | "disabled";

export interface DeliveryOutcome {
  status: DeliveryStatus;
  error?: string;
}

export interface DeliveryDeps {
  fetch?: typeof fetch;
  /** Label used in console-mode logs, e.g. "owner-alert" or "customer". */
  label?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/** Guarded so this module also imports cleanly outside Deno (tests). */
export function envGet(name: string): string {
  const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  try {
    return deno?.env?.get(name) ?? "";
  } catch {
    // Deno without --allow-env: treat as unset rather than crashing a request.
    return "";
  }
}

export function readEmailProviderConfig(): EmailProviderConfig {
  return {
    provider: envGet("EMAIL_PROVIDER") || "console",
    from: envGet("EMAIL_FROM") || "orders@example.com",
    apiKey: envGet("RESEND_API_KEY"),
  };
}

/** Base URL for customer-facing links (order tracking). May be empty. */
export function readSiteBaseUrl(): string {
  const origin = envGet("ALLOWED_ORIGIN");
  return (envGet("SITE_URL") || (origin.startsWith("http") ? origin : "")).replace(/\/+$/, "");
}

/** Everything interpolated into an email body can contain customer text. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Provider errors are persisted on the order and shown in Admin. Strip
 * anything key-shaped and cap the length so a giant HTML error page cannot
 * bloat the order row.
 */
export function redactError(message: string): string {
  return message
    .replace(/re_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key"?\s*[:=]\s*"?)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .slice(0, 300);
}

/** A usable email address. Deliberately permissive — the provider is the
 * real authority; this only catches the obviously unsendable. */
export function isSendableAddress(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 5 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Sends one message and reports what actually happened. Never throws — every
 * failure path resolves to an outcome, so no caller can be broken by email.
 */
export async function deliverEmail(
  config: EmailProviderConfig,
  message: EmailMessage,
  deps: DeliveryDeps = {},
): Promise<DeliveryOutcome> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const label = deps.label ?? "email";

  try {
    if (!isSendableAddress(message.to)) {
      return { status: "failed", error: `no usable recipient address (${message.to ? "invalid" : "missing"})` };
    }
    if (config.provider !== "resend") {
      // Console mode: visible in function logs, never counted as delivered.
      console.log(`[${label}:console] to=${message.to} subject=${message.subject}`);
      return { status: "disabled", error: `EMAIL_PROVIDER=${config.provider || "console"} — email not sent` };
    }
    if (!config.apiKey) {
      // Real delivery was asked for and did not happen: surface it.
      return { status: "failed", error: "EMAIL_PROVIDER=resend but RESEND_API_KEY is not set" };
    }
    if (!config.from) {
      return { status: "failed", error: "EMAIL_FROM is not set" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          /* body unreadable — the status alone is enough to debug */
        }
        return { status: "failed", error: redactError(`resend ${res.status}${detail ? `: ${detail}` : ""}`) };
      }
      return { status: "sent" };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message_ = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { status: "failed", error: redactError(message_) };
  }
}
