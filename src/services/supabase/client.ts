/**
 * Thin, dependency-free Supabase client (PostgREST + GoTrue + Edge
 * Functions over fetch). Only the public anon key is ever used here —
 * privileged operations live in edge functions; row access is enforced by
 * RLS + database role checks (supabase/migrations/0007_rls.sql).
 */
import { getConfig } from "../../lib/env.ts";

const SESSION_KEY = "crowned_sb_session_v1";

export interface SbSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

/**
 * Reads the `sub`/`email` claims out of an access token so a recovery session
 * has the same shape as a normal one. The signature is NOT verified here and
 * never needs to be — every privileged read is still checked server-side by
 * RLS. The token itself is never logged or returned.
 */
function readTokenClaims(accessToken: string): { sub: string; email?: string } {
  try {
    const payload = accessToken.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { sub?: string; email?: string };
    return { sub: String(claims.sub ?? ""), ...(claims.email ? { email: claims.email } : {}) };
  } catch {
    return { sub: "" };
  }
}

export class SupabaseClient {
  readonly url: string;
  readonly anonKey: string;

  constructor() {
    const cfg = getConfig();
    this.url = cfg.supabaseUrl.replace(/\/$/, "");
    this.anonKey = cfg.supabaseAnonKey;
  }

  get configured(): boolean {
    return this.url !== "" && this.anonKey !== "";
  }

  /* ── session persistence ── */
  loadSession(): SbSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as SbSession;
      if (s.expires_at * 1000 < Date.now() + 30_000) return s; // caller refreshes
      return s;
    } catch {
      return null;
    }
  }

  saveSession(s: SbSession | null): void {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  private headers(auth = true): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.anonKey,
      "Content-Type": "application/json",
    };
    const session = auth ? this.loadSession() : null;
    h.Authorization = `Bearer ${session?.access_token ?? this.anonKey}`;
    return h;
  }

  /* ── GoTrue auth ── */
  async signInWithPassword(email: string, password: string): Promise<{ session?: SbSession; error?: string }> {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: this.headers(false),
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { error: String(body.error_description ?? body.msg ?? "invalid_credentials") };
    const session = body as unknown as SbSession;
    this.saveSession(session);
    return { session };
  }

  async signUp(email: string, password: string, name: string): Promise<{ session?: SbSession; error?: string }> {
    const res = await fetch(`${this.url}/auth/v1/signup`, {
      method: "POST",
      headers: this.headers(false),
      body: JSON.stringify({ email, password, data: { name } }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { error: String(body.error_description ?? body.msg ?? "signup_failed") };
    if (body.access_token) {
      const session = body as unknown as SbSession;
      this.saveSession(session);
      return { session };
    }
    return { error: "confirm_email" };
  }

  async refreshIfNeeded(): Promise<SbSession | null> {
    const s = this.loadSession();
    if (!s) return null;
    if (s.expires_at * 1000 > Date.now() + 60_000) return s;
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: this.headers(false),
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) {
      this.saveSession(null);
      return null;
    }
    const next = (await res.json()) as SbSession;
    this.saveSession(next);
    return next;
  }

  /**
   * Sends a password-recovery email (GoTrue POST /auth/v1/recover).
   *
   * Deliberately reports success for every well-formed request: GoTrue itself
   * returns 200 for unknown addresses, and this method must never let the
   * caller distinguish "sent" from "no such account". Errors are swallowed for
   * the same reason — a 4xx here would otherwise be an enumeration oracle.
   */
  async resetPasswordForEmail(email: string, redirectTo: string): Promise<{ ok: true }> {
    try {
      await fetch(`${this.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        headers: this.headers(false),
        body: JSON.stringify({ email }),
      });
    } catch {
      /* network failure is not an account-existence signal either */
    }
    return { ok: true };
  }

  /**
   * Adopts the short-lived session carried by a recovery link so the following
   * `updateUser` call is authorized. The tokens are persisted exactly like a
   * normal sign-in and are never logged.
   */
  adoptRecoverySession(tokens: { accessToken: string; refreshToken: string; expiresAt: number }): void {
    const claims = readTokenClaims(tokens.accessToken);
    this.saveSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      user: { id: claims.sub, ...(claims.email ? { email: claims.email } : {}) },
    });
  }

  /** GoTrue PUT /auth/v1/user — the only place a new password is set. */
  async updateUser(attributes: { password: string }): Promise<{ error?: string }> {
    const res = await fetch(`${this.url}/auth/v1/user`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(attributes),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body.error_description ?? body.msg ?? "update_failed") };
    return {};
  }

  async signOut(): Promise<void> {
    const s = this.loadSession();
    if (s) {
      await fetch(`${this.url}/auth/v1/logout`, { method: "POST", headers: this.headers() }).catch(() => undefined);
    }
    this.saveSession(null);
  }

  /* ── PostgREST ── */
  async select<T>(table: string, query: string): Promise<T[]> {
    await this.refreshIfNeeded();
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`select ${table}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T[];
  }

  async insert<T>(table: string, rows: unknown, returning = false): Promise<T[]> {
    await this.refreshIfNeeded();
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: returning ? "return=representation" : "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`insert ${table}: ${res.status} ${await res.text()}`);
    return returning ? ((await res.json()) as T[]) : [];
  }

  async update(table: string, query: string, patch: unknown): Promise<void> {
    await this.refreshIfNeeded();
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`update ${table}: ${res.status} ${await res.text()}`);
  }

  async delete(table: string, query: string): Promise<void> {
    await this.refreshIfNeeded();
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, { method: "DELETE", headers: this.headers() });
    if (!res.ok) throw new Error(`delete ${table}: ${res.status} ${await res.text()}`);
  }

  /* ── Edge functions ── */
  async invoke<T>(name: string, payload: unknown): Promise<T> {
    await this.refreshIfNeeded();
    const res = await fetch(`${this.url}/functions/v1/${name}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `invoke ${name}: ${res.status}`);
    return body;
  }
}
