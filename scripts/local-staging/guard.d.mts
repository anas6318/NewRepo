/** Types for guard.mjs (consumed by tests/unit/local-staging-guard.test.ts). */
export declare const REPO_ROOT: string;
export declare const PROJECT_REF_PATH: string;
export declare const LOCAL_API_PORT: string;

export declare function isLocalHostname(hostname: unknown): boolean;
export declare function isForbiddenRemoteHostname(hostname: unknown): boolean;

export declare function environmentRefusals(input: { env: Record<string, string | undefined>; projectRefExists: boolean }): string[];

export declare function evaluateLocalStack(input: {
  status: Record<string, unknown> | null | undefined;
  env: Record<string, string | undefined>;
  projectRefExists: boolean;
}): { ok: true } | { ok: false; reasons: string[] };

export declare function checkRequestUrl(url: unknown): { ok: true } | { ok: false; reason: string };

export interface LocalStack {
  readonly apiUrl: string;
  readonly restUrl: string;
  readonly authUrl: string;
  readonly functionsUrl: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

export declare function loadLocalStack(): LocalStack;
export declare function installNetworkGuard(): void;
export declare function guardLocal(): LocalStack;
