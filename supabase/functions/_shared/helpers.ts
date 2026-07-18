/**
 * Shared helpers for CROWNED edge functions (Deno runtime).
 *
 * NOTE ON VERIFICATION: these functions are architecture-complete and
 * carefully written, but were authored in an environment with no live
 * Supabase project — deploy to a staging project and run the smoke steps in
 * docs/deployment-guide.md before trusting them in production.
 */

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  return null;
}

/** Service-role PostgREST call — bypasses RLS; use only after explicit
 * authorization checks in the calling function. */
export async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function dbSelect<T>(path: string): Promise<T[]> {
  const res = await db(path);
  if (!res.ok) throw new Error(`db select failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

export async function dbInsert(table: string, rows: unknown): Promise<void> {
  const res = await db(table, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "return=minimal" } });
  if (!res.ok) throw new Error(`db insert failed: ${res.status} ${await res.text()}`);
}

export async function dbUpdate(path: string, patch: unknown): Promise<void> {
  const res = await db(path, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`db update failed: ${res.status} ${await res.text()}`);
}

/** Resolves the calling user's profile from their JWT (or null for anon). */
export async function callerProfile(req: Request): Promise<{ id: string; email: string; role: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token === ANON_KEY) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { id: string };
  const profiles = await dbSelect<{ id: string; email: string; role: string }>(`profiles?select=id,email,role&id=eq.${user.id}`);
  return profiles[0] ?? null;
}

export async function requireStaff(req: Request): Promise<{ id: string; email: string; role: string }> {
  const profile = await callerProfile(req);
  if (!profile || profile.role === "customer") throw new HttpError(403, "forbidden");
  return profile;
}

export async function requireAdminOrOwner(req: Request): Promise<{ id: string; email: string; role: string }> {
  const profile = await requireStaff(req);
  if (profile.role !== "admin" && profile.role !== "owner") throw new HttpError(403, "forbidden");
  return profile;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handleError(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error("[edge] unexpected error:", err);
  return json({ error: "internal_error" }, 500);
}

export async function audit(actor: string, action: string, target: string, detail?: string): Promise<void> {
  try {
    await dbInsert("audit_log", { actor, action, target, detail: detail ?? null });
  } catch (e) {
    console.error("[edge] audit write failed:", e);
  }
}

/** sha256 hex of the tracking secret + normalized contact. */
export async function contactHash(contact: string): Promise<string> {
  const secret = Deno.env.get("TRACKING_HASH_SECRET") ?? "";
  const normalized = contact.trim().toLowerCase().replace(/[\s-]/g, "");
  const bytes = new TextEncoder().encode(`${secret}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Email dispatch: console mode unless a real provider is configured.
 * NEVER claims delivery it didn't perform. */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ sent: boolean; mode: string }> {
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "console";
  const from = Deno.env.get("EMAIL_FROM") ?? "orders@example.com";
  if (provider === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      console.warn("[email] EMAIL_PROVIDER=resend but RESEND_API_KEY missing — falling back to console");
      console.log(`[email:console] to=${to} subject=${subject}`);
      return { sent: false, mode: "console-fallback" };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] resend failed: ${res.status} ${await res.text()}`);
      return { sent: false, mode: "resend-error" };
    }
    return { sent: true, mode: "resend" };
  }
  console.log(`[email:console] to=${to} subject=${subject}\n${html.slice(0, 400)}…`);
  return { sent: false, mode: "console" };
}
