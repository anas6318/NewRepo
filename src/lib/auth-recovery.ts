/**
 * Password-recovery helpers.
 *
 * Kept as a dependency-free module so the rules that matter — the minimum
 * password length shared with registration, the shape of a Supabase recovery
 * link, and how the redirect URL is built — are unit-testable without a
 * browser or a Supabase project.
 *
 * SECURITY NOTES
 *  - Nothing here logs, stores or returns a recovery token. `parseRecoveryFragment`
 *    hands the tokens straight back to the caller, which passes them to the
 *    auth client and then clears the URL fragment.
 *  - No function here can report whether an account exists. Account existence
 *    is never an input to, or an output of, this module.
 */

/** Same rule the registration form already enforces (AuthPages RegisterPage). */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordProblem = "too_short" | "mismatch";

/** Validates a new password + confirmation. Returns undefined when valid. */
export function validateNewPassword(password: string, confirm: string): PasswordProblem | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return undefined;
}

/**
 * Where Supabase should send the user after they click the emailed link.
 *
 * Always the SAME-ORIGIN, same-locale reset page, so an Arabic user who asked
 * for a reset lands back on /ar/reset-password. The origin comes from the
 * running page, never from user input, so this cannot be pointed at another
 * host. This exact URL must also be present in the Supabase dashboard's
 * redirect allow-list — see docs/deployment-guide.md.
 */
export function resetRedirectUrl(origin: string, locale: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/reset-password`;
}

export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

export type RecoveryParse = { ok: true; tokens: RecoveryTokens } | { ok: false; error: "expired_link" | "invalid_link" };

/**
 * Reads the tokens GoTrue puts in the URL fragment of a recovery link:
 *   /ar/reset-password#access_token=…&refresh_token=…&expires_in=3600&type=recovery
 *
 * An expired or already-used link arrives as `#error=…&error_description=…`
 * instead, which is reported as `expired_link` rather than thrown.
 */
export function parseRecoveryFragment(hash: string, nowMs: number = Date.now()): RecoveryParse {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { ok: false, error: "invalid_link" };
  const params = new URLSearchParams(raw);

  if (params.get("error") || params.get("error_code")) {
    const description = params.get("error_description") ?? "";
    // GoTrue reports both expiry and reuse as otp_expired / access_denied.
    return { ok: false, error: /expire|otp_expired|access_denied/i.test(`${params.get("error_code") ?? ""} ${params.get("error") ?? ""} ${description}`) ? "expired_link" : "invalid_link" };
  }

  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  if (!accessToken || !refreshToken) return { ok: false, error: "invalid_link" };
  if (params.get("type") !== "recovery") return { ok: false, error: "invalid_link" };

  const expiresIn = Number.parseInt(params.get("expires_in") ?? "", 10);
  const expiresAt = Number.isFinite(expiresIn) ? Math.floor(nowMs / 1000) + expiresIn : Math.floor(nowMs / 1000) + 3600;
  return { ok: true, tokens: { accessToken, refreshToken, expiresAt } };
}
