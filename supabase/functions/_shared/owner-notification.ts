/**
 * Owner order-alert email.
 *
 * One job: after an order is already committed, tell the owner about it.
 * It is deliberately SECONDARY to the order — every failure path here
 * returns a status object, never throws, so nothing in this file can undo,
 * block or fail a checkout that already succeeded.
 *
 * Honesty rule (same as _shared/helpers.ts `sendEmail`): a status of "sent"
 * means a provider accepted the message. Console mode and missing
 * configuration are reported as "disabled"/"failed" — never as "sent".
 *
 * Runtime: written for Deno (edge functions) but with no top-level Deno
 * access and an injectable `fetch`, so tests/unit/order-notification.test.ts
 * exercises this exact module under Node. Keep it that way.
 *
 * Privacy: supplier cost, supplier SKU and the badge's internal supplier
 * reference are deliberately NOT included. The owner has those in Admin;
 * an email is a copy that travels, so it carries only what is needed to act
 * on the order.
 */

export type OwnerNotificationStatus = "pending" | "sent" | "failed" | "disabled";

/** Mirrors the existing `sheetsSync` shape on an order, deliberately:
 *  staff already read that badge the same way. */
export interface OwnerNotificationResult {
  status: OwnerNotificationStatus;
  lastAttemptAt?: string;
  error?: string;
}

export interface OwnerNotificationConfig {
  /** EMAIL_PROVIDER — "resend" sends for real; anything else is console. */
  provider: string;
  /** ORDER_NOTIFICATION_EMAIL — where the owner alert goes. */
  recipient: string;
  /** EMAIL_FROM — verified sender on the provider. */
  from: string;
  /** RESEND_API_KEY — server-side only, never logged or echoed. */
  apiKey: string;
  /** Base URL used to build the direct admin-order link. May be empty. */
  adminBaseUrl: string;
}

/* ── The slice of an order this module reads ──────────────────────────────
   Structural and defensive: every field is optional so a partially-shaped
   order can still produce a useful alert instead of throwing. */

export interface OwnerOrderItemView {
  title?: Record<string, string> | string;
  slug?: string;
  quantity?: number;
  size?: string;
  version?: string;
  sleeve?: string;
  personalization?: { name?: string; number?: string };
  /** Badge snapshot. `supplierReference` is intentionally never read. */
  badge?: { name?: Record<string, string> | string; priceIls?: number };
  patchName?: Record<string, string> | string;
  unitPriceIls?: number;
  lineTotalIls?: number;
}

export interface OwnerOrderView {
  orderNumber?: string;
  createdAt?: string;
  locale?: string;
  customer?: { name?: string; email?: string; phone?: string; city?: string; address?: string; notes?: string };
  items?: OwnerOrderItemView[];
  subtotalIls?: number;
  promotion?: { labelText?: string };
  promotionDiscountIls?: number;
  deliveryIls?: number;
  freeDelivery?: boolean;
  totalIls?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  supplierConfirmation?: { required?: boolean; status?: string; items?: { slug?: string; version?: string; size?: string }[] };
  internalNotes?: string;
  notification?: { status?: string };
}

/* ── Configuration ─────────────────────────────────────────────────────── */

function envGet(name: string): string {
  // Guarded so this module also imports cleanly outside Deno (tests).
  const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  try {
    return deno?.env?.get(name) ?? "";
  } catch {
    // Deno without --allow-env: treat as unset rather than crashing a checkout.
    return "";
  }
}

/**
 * Reads the four documented secrets plus an optional base URL for the
 * admin deep link. All server-side only — none of these is a VITE_ variable
 * and none is ever returned to the browser.
 */
export function readOwnerNotificationConfig(): OwnerNotificationConfig {
  const origin = envGet("ALLOWED_ORIGIN");
  return {
    provider: envGet("EMAIL_PROVIDER") || "console",
    recipient: envGet("ORDER_NOTIFICATION_EMAIL").trim(),
    from: envGet("EMAIL_FROM") || "orders@example.com",
    apiKey: envGet("RESEND_API_KEY"),
    // ALLOWED_ORIGIN is already the site origin in a real deployment, but it
    // may legitimately be "*" — which is not a link.
    adminBaseUrl: (envGet("ADMIN_BASE_URL") || envGet("SITE_URL") || (origin.startsWith("http") ? origin : "")).replace(/\/+$/, ""),
  };
}

/* ── Formatting helpers ────────────────────────────────────────────────── */

const money = (n: number | undefined): string => `₪${typeof n === "number" ? Math.round(n * 100) / 100 : 0}`;

function text(value: Record<string, string> | string | undefined, locale = "en"): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value[locale] || value.en || Object.values(value)[0] || "";
  return "";
}

/** Everything interpolated below can contain customer-supplied text. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Provider errors are stored on the order and shown in Admin. Strip anything
 * key-shaped before it is persisted, and cap the length so a giant HTML
 * error page cannot bloat the order row.
 */
export function redactError(message: string): string {
  return message
    .replace(/re_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key"?\s*[:=]\s*"?)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .slice(0, 300);
}

/** Direct link to the order in Admin, when a base URL is configured. */
export function adminOrderUrl(baseUrl: string, orderNumber: string): string {
  if (!baseUrl || !orderNumber) return "";
  return `${baseUrl.replace(/\/+$/, "")}/admin/orders/${encodeURIComponent(orderNumber)}`;
}

/* ── Email body ────────────────────────────────────────────────────────── */

function itemLines(order: OwnerOrderView): string[] {
  return (order.items ?? []).map((item) => {
    const parts: string[] = [`${text(item.title) || item.slug || "item"} ×${item.quantity ?? 1}`];
    if (item.size) parts.push(`size ${item.size}`);
    if (item.version) parts.push(`version ${item.version}`);
    if (item.sleeve) parts.push(`${item.sleeve} sleeve`);
    const p = item.personalization;
    if (p && (p.name || p.number)) parts.push(`personalization ${[p.name, p.number].filter(Boolean).join(" ")}`);
    // Badge NAME and price only — the snapshot's supplier reference stays in Admin.
    const badgeName = text(item.badge?.name) || text(item.patchName);
    parts.push(badgeName ? `badge ${badgeName}${item.badge?.priceIls ? ` (+${money(item.badge.priceIls)})` : ""}` : "no badge");
    parts.push(`${money(item.unitPriceIls)}/unit`);
    parts.push(`line ${money(item.lineTotalIls)}`);
    return parts.join(" · ");
  });
}

/**
 * Builds the owner alert. English: the admin surface of this store is
 * English, and the owner reads this next to Admin → Orders.
 */
export function buildOwnerOrderEmail(order: OwnerOrderView, adminBaseUrl = ""): { subject: string; html: string; text: string } {
  const number = order.orderNumber ?? "(no order number)";
  const created = order.createdAt ? new Date(order.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown";
  const link = adminOrderUrl(adminBaseUrl, number);
  const c = order.customer ?? {};
  const waiting = order.supplierConfirmation?.required === true && order.supplierConfirmation.status === "pending";

  const facts: [string, string][] = [
    ["Order", number],
    ["Placed", created],
    ["Customer", c.name ?? "—"],
    ["Phone", c.phone ?? "—"],
    ["Email", c.email ?? "—"],
    ["City", c.city ?? "—"],
    ["Address", c.address ?? "—"],
    ["Payment", `${order.paymentMethod ?? "—"} — ${order.paymentStatus ?? "—"}`],
    ["Fulfillment", order.fulfillmentStatus ?? "—"],
  ];

  const totals: [string, string][] = [
    ["Subtotal", money(order.subtotalIls)],
    ...((order.promotionDiscountIls ?? 0) > 0
      ? ([[order.promotion?.labelText || "Promotion", `−${money(order.promotionDiscountIls)}`]] as [string, string][])
      : []),
    ["Delivery", `${money(order.deliveryIls)}${order.freeDelivery ? " (free delivery applied)" : ""}`],
    ["Total", money(order.totalIls)],
  ];

  const notes: string[] = [];
  if (waiting) {
    const lines = (order.supplierConfirmation?.items ?? [])
      .map((i) => [i.slug, i.version, i.size].filter(Boolean).join(" / "))
      .filter(Boolean);
    notes.push(`Waiting for supplier confirmation${lines.length ? `: ${lines.join(", ")}` : ""}. Nothing is ordered or produced until you confirm.`);
  }
  if (c.notes) notes.push(`Customer note: ${c.notes}`);
  if (order.internalNotes) notes.push(`Internal note: ${order.internalNotes}`);

  const items = itemLines(order);

  const plain = [
    `New CROWNED order ${number}`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    "Items:",
    ...items.map((l) => `  - ${l}`),
    "",
    ...totals.map(([k, v]) => `${k}: ${v}`),
    ...(notes.length ? ["", ...notes] : []),
    ...(link ? ["", `Open in Admin: ${link}`] : []),
  ].join("\n");

  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#7c7a74;font-size:13px;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:13px;color:#0b0b0d;">${escapeHtml(v)}</td></tr>`;

  const html = `<!doctype html><html lang="en" dir="ltr"><body style="margin:0;background:#f6f4ef;font-family:Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:28px 20px;">
    <p style="letter-spacing:4px;color:#c6a355;font-size:12px;font-weight:bold;margin:0 0 12px;">CROWNED · ADMIN</p>
    <h1 style="font-size:20px;margin:0 0 4px;color:#0b0b0d;">New order ${escapeHtml(number)}</h1>
    <p style="font-size:13px;color:#7c7a74;margin:0 0 20px;">${escapeHtml(money(order.totalIls))} · ${escapeHtml(order.fulfillmentStatus ?? "—")}</p>
    ${waiting ? `<p style="background:#fdf3e0;border:1px solid #e6cf9a;border-radius:8px;padding:10px 12px;font-size:13px;color:#5c4a1e;margin:0 0 18px;">Waiting for supplier confirmation — nothing is ordered or produced yet.</p>` : ""}
    <table style="border-collapse:collapse;margin:0 0 20px;">${facts.map(([k, v]) => row(k, v)).join("")}</table>
    <h2 style="font-size:14px;margin:0 0 8px;color:#0b0b0d;">Items</h2>
    <ul style="margin:0 0 20px;padding-inline-start:18px;font-size:13px;color:#0b0b0d;line-height:1.7;">
      ${items.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
    </ul>
    <table style="border-collapse:collapse;margin:0 0 20px;">${totals.map(([k, v]) => row(k, v)).join("")}</table>
    ${notes.length ? `<div style="border-top:1px solid #e2ded4;padding-top:12px;margin-bottom:20px;">${notes.map((n) => `<p style="font-size:13px;color:#4a4a52;margin:0 0 8px;">${escapeHtml(n)}</p>`).join("")}</div>` : ""}
    ${link ? `<p style="margin:0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0b0b0d;color:#f6f4ef;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;">Open in Admin</a></p>` : ""}
    <p style="font-size:11px;color:#7c7a74;margin-top:22px;">Internal notification — do not forward to the customer.</p>
  </div></body></html>`;

  return { subject: `New CROWNED order ${number} — ${money(order.totalIls)}`, html, text: plain };
}

/* ── Duplicate protection ──────────────────────────────────────────────── */

/**
 * True only for an order that has never been through an owner-alert attempt.
 * place-order calls this immediately after the insert; every other code path
 * (tracking, admin reads, Sheets sync, webhooks) must never call the sender
 * at all, so an order can produce at most one owner email.
 */
export function shouldSendOwnerNotification(order: OwnerOrderView): boolean {
  const status = order.notification?.status;
  return status === undefined || status === "pending";
}

/* ── Sending ───────────────────────────────────────────────────────────── */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/**
 * Attempts the owner alert and reports what actually happened.
 *
 * Never throws. Never retries (a retry that hangs would delay the customer's
 * confirmation response); a failed alert is recorded on the order so staff
 * can see it in Admin and re-send by hand.
 */
export async function sendOwnerOrderNotification(
  order: OwnerOrderView,
  config: OwnerNotificationConfig = readOwnerNotificationConfig(),
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<OwnerNotificationResult> {
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const doFetch = deps.fetch ?? globalThis.fetch;

  try {
    if (!config.recipient) {
      return { status: "disabled", lastAttemptAt: at, error: "ORDER_NOTIFICATION_EMAIL is not set" };
    }
    if (config.provider !== "resend") {
      // Console mode: log it so it is visible in function logs, but never
      // claim a delivery that did not happen.
      const built = buildOwnerOrderEmail(order, config.adminBaseUrl);
      console.log(`[owner-notification:console] to=${config.recipient} subject=${built.subject}\n${built.text}`);
      return { status: "disabled", lastAttemptAt: at, error: `EMAIL_PROVIDER=${config.provider || "console"} — owner email not sent` };
    }
    if (!config.apiKey) {
      // The owner asked for real delivery and did not get it: that is a
      // failure to surface, not a quiet fallback.
      return { status: "failed", lastAttemptAt: at, error: "EMAIL_PROVIDER=resend but RESEND_API_KEY is not set" };
    }

    const built = buildOwnerOrderEmail(order, config.adminBaseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: config.from, to: config.recipient, subject: built.subject, html: built.html, text: built.text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          /* body already consumed or unreadable — status alone is enough */
        }
        return { status: "failed", lastAttemptAt: at, error: redactError(`resend ${res.status}${detail ? `: ${detail}` : ""}`) };
      }
      return { status: "sent", lastAttemptAt: at };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { status: "failed", lastAttemptAt: at, error: redactError(message) };
  }
}
