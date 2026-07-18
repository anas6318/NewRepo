/**
 * sheets-sync — mirrors orders into a NEW Google Sheet (spec §24).
 * Postgres remains the source of truth; this is a one-way mirror with a
 * retry queue (sheets_sync_log). Never connects to any legacy spreadsheet —
 * the target sheet ID comes exclusively from GOOGLE_SHEET_ID.
 *
 * Called: (a) fire-and-forget after order changes, (b) manually from admin
 * ("Resync"), (c) on a schedule to drain failures (docs/google-sheets-setup.md).
 */
import { audit, dbSelect, dbUpdate, handleError, json, preflight, requireStaff, SERVICE_ROLE_KEY } from "../_shared/helpers.ts";

const SHEET_ID = Deno.env.get("GOOGLE_SHEET_ID") ?? "";
const SA_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
const SA_KEY = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").replaceAll("\\n", "\n");

const HEADER = [
  "internal_id", "order_number", "order_date", "customer_name", "phone", "email", "language", "country", "city", "address",
  "products", "skus", "categories", "versions", "sizes", "sleeves", "custom_names", "custom_numbers", "patches", "quantities",
  "unit_prices", "delivery_fee", "total", "payment_method", "payment_status", "fulfillment_status", "supplier_reference",
  "production_started", "supplier_dispatched", "tracking_number", "customer_notes", "internal_notes",
];

async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const claims = btoa(
    JSON.stringify({
      iss: SA_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const unsigned = `${header}.${claims}`;

  const pem = SA_KEY.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`google token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function orderToRow(o: Record<string, never> | Record<string, unknown>): string[] {
  const d = o as {
    id: string; orderNumber: string; createdAt: string; locale: string;
    customer: { name: string; phone: string; email: string; city: string; address: string; notes?: string };
    items: { title: { en: string }; slug: string; version?: string; size: string; sleeve?: string; personalization?: { name?: string; number?: string }; patchName?: { en: string }; quantity: number; unitPriceIls: number }[];
    deliveryIls: number; totalIls: number; paymentMethod: string; paymentStatus: string; fulfillmentStatus: string;
    supplierReference?: string; productionStartedAt?: string; supplierDispatchedAt?: string; trackingNumber?: string; internalNotes?: string;
  };
  const items = d.items;
  const col = (fn: (i: (typeof items)[number]) => string | number | undefined) => items.map((i) => fn(i) ?? "").join(" | ");
  return [
    d.id, d.orderNumber, d.createdAt, d.customer.name, d.customer.phone, d.customer.email, d.locale, "IL", d.customer.city, d.customer.address,
    col((i) => i.title.en), col((i) => i.slug), "", col((i) => i.version), col((i) => i.size), col((i) => i.sleeve),
    col((i) => i.personalization?.name), col((i) => i.personalization?.number), col((i) => i.patchName?.en), col((i) => i.quantity),
    col((i) => i.unitPriceIls), String(d.deliveryIls), String(d.totalIls), d.paymentMethod, d.paymentStatus, d.fulfillmentStatus,
    d.supplierReference ?? "", d.productionStartedAt ?? "", d.supplierDispatchedAt ?? "", d.trackingNumber ?? "", d.customer.notes ?? "", d.internalNotes ?? "",
  ];
}

async function syncOne(orderNumber: string): Promise<{ ok: boolean; message: string }> {
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
    await dbUpdate(`sheets_sync_log?order_number=eq.${encodeURIComponent(orderNumber)}&status=eq.pending`, {
      status: "disabled",
      last_error: "Google Sheets not configured (GOOGLE_SHEET_ID / service account missing)",
      updated_at: new Date().toISOString(),
    });
    return { ok: false, message: "Google Sheets is not configured — sync recorded as disabled, nothing was sent." };
  }

  const rows = await dbSelect<{ data: Record<string, unknown> }>(`orders?select=data&order_number=eq.${encodeURIComponent(orderNumber)}`);
  const order = rows[0]?.data;
  if (!order) return { ok: false, message: "Order not found" };

  try {
    const token = await googleAccessToken();
    // Ensure header row exists (idempotent write to A1).
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1?valueInputOption=RAW`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: [HEADER] }),
    });
    // Duplicate prevention: find an existing row for this order number.
    const existing = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/B:B`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const colB = ((await existing.json()) as { values?: string[][] }).values ?? [];
    const rowIndex = colB.findIndex((r) => r[0] === orderNumber);
    const rowValues = orderToRow(order as Record<string, unknown>);

    if (rowIndex >= 0) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A${rowIndex + 1}?valueInputOption=RAW`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ values: [rowValues] }),
      });
    } else {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ values: [rowValues] }),
      });
    }

    await dbUpdate(`sheets_sync_log?order_number=eq.${encodeURIComponent(orderNumber)}`, {
      status: "synced",
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    const orderObj = order as { sheetsSync?: unknown };
    orderObj.sheetsSync = { status: "synced", lastAttemptAt: new Date().toISOString() };
    await dbUpdate(`orders?order_number=eq.${encodeURIComponent(orderNumber)}`, { data: order });
    return { ok: true, message: "Synced to Google Sheets." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dbUpdate(`sheets_sync_log?order_number=eq.${encodeURIComponent(orderNumber)}`, {
      status: "failed",
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    });
    return { ok: false, message: `Sync failed (queued for retry): ${message.slice(0, 200)}` };
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const auth = req.headers.get("authorization") ?? "";
    const isServiceCall = auth === `Bearer ${SERVICE_ROLE_KEY}`;
    const body = (await req.json().catch(() => ({}))) as { orderNumber?: string; manual?: boolean; drain?: boolean };

    if (!isServiceCall) {
      const staff = await requireStaff(req); // manual resync from admin
      await audit(staff.email, "sheets_resync_requested", body.orderNumber ?? "drain");
    }

    if (body.drain) {
      const pending = await dbSelect<{ order_number: string }>("sheets_sync_log?select=order_number&status=in.(pending,failed)&limit=20");
      const results = [];
      for (const p of pending) results.push(await syncOne(p.order_number));
      return json({ ok: true, drained: results.length, results });
    }
    if (!body.orderNumber) return json({ error: "orderNumber required" }, 400);
    return json(await syncOne(body.orderNumber));
  } catch (err) {
    return handleError(err);
  }
});
