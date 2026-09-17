/**
 * Minimal schema-validation library (Zod-style API subset). Ships locally for
 * the same reason as the router — the build environment had no registry
 * access, and the spec allows "an equivalent schema-validation library".
 * Unit-tested in tests/unit/schema.test.ts.
 */

export interface Issue {
  path: string;
  /**
   * English text. Kept for logs, tests and non-customer surfaces — it is NOT
   * safe to show a customer, because the storefront is Arabic and Hebrew too.
   */
  message: string;
  /**
   * Stable, translatable identifier for the same failure, plus whatever the
   * message interpolates. Customer-facing forms localize from this via
   * src/lib/form-errors.ts; `message` is the developer's copy.
   */
  code?: IssueCode;
  params?: Record<string, string | number>;
}

export type IssueCode =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "invalid_email"
  | "invalid_phone"
  | "not_a_number"
  | "not_a_whole_number"
  | "invalid_value"
  | "must_be_true"
  | "not_a_list"
  | "not_an_object";

export type ParseResult<T> = { success: true; data: T } | { success: false; issues: Issue[] };

export abstract class Schema<T> {
  abstract check(value: unknown, path: string, issues: Issue[]): T;

  safeParse(value: unknown): ParseResult<T> {
    const issues: Issue[] = [];
    const data = this.check(value, "", issues);
    return issues.length ? { success: false, issues } : { success: true, data };
  }

  optional(): Schema<T | undefined> {
    return new OptionalSchema(this);
  }
}

class OptionalSchema<T> extends Schema<T | undefined> {
  private inner: Schema<T>;

  constructor(inner: Schema<T>) {
    super();
    this.inner = inner;
  }

  check(value: unknown, path: string, issues: Issue[]): T | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return this.inner.check(value, path, issues);
  }
}

type Rule<T> = { test: (v: T) => boolean; message: string; code: IssueCode; params?: Record<string, string | number> };

class StringSchema extends Schema<string> {
  private rules: Rule<string>[] = [];
  private doTrim = false;

  trim(): this {
    this.doTrim = true;
    return this;
  }

  min(n: number, message = `Must be at least ${n} characters`): this {
    this.rules.push({ test: (v) => v.length >= n, message, code: "too_short", params: { min: n } });
    return this;
  }

  max(n: number, message = `Must be at most ${n} characters`): this {
    this.rules.push({ test: (v) => v.length <= n, message, code: "too_long", params: { max: n } });
    return this;
  }

  regex(re: RegExp, message = "Invalid format", code: IssueCode = "invalid_format"): this {
    this.rules.push({ test: (v) => re.test(v), message, code });
    return this;
  }

  email(message = "Invalid email address"): this {
    return this.regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message, "invalid_email");
  }

  /** Israeli-friendly phone: digits, spaces, dashes, optional +. */
  phone(message = "Invalid phone number"): this {
    this.rules.push({
      test: (v) => /^\+?[0-9][0-9\s-]{6,17}$/.test(v),
      message,
      code: "invalid_phone",
    });
    return this;
  }

  check(value: unknown, path: string, issues: Issue[]): string {
    if (typeof value !== "string") {
      issues.push({ path, message: "Required", code: "required" });
      return "";
    }
    const v = this.doTrim ? value.trim() : value;
    for (const rule of this.rules) {
      if (!rule.test(v)) {
        issues.push({ path, message: rule.message, code: rule.code, ...(rule.params ? { params: rule.params } : {}) });
        return v;
      }
    }
    return v;
  }
}

class NumberSchema extends Schema<number> {
  private rules: Rule<number>[] = [];

  int(message = "Must be a whole number"): this {
    this.rules.push({ test: (v) => Number.isInteger(v), message, code: "not_a_whole_number" });
    return this;
  }

  min(n: number, message = `Must be ≥ ${n}`): this {
    this.rules.push({ test: (v) => v >= n, message, code: "too_short", params: { min: n } });
    return this;
  }

  max(n: number, message = `Must be ≤ ${n}`): this {
    this.rules.push({ test: (v) => v <= n, message, code: "too_long", params: { max: n } });
    return this;
  }

  check(value: unknown, path: string, issues: Issue[]): number {
    const v = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof v !== "number" || Number.isNaN(v)) {
      issues.push({ path, message: "Must be a number", code: "not_a_number" });
      return 0;
    }
    for (const rule of this.rules) {
      if (!rule.test(v)) {
        issues.push({ path, message: rule.message, code: rule.code, ...(rule.params ? { params: rule.params } : {}) });
        return v;
      }
    }
    return v;
  }
}

class BooleanSchema extends Schema<boolean> {
  private mustBeTrue = false;
  private trueMessage = "Required";

  true(message = "This confirmation is required"): this {
    this.mustBeTrue = true;
    this.trueMessage = message;
    return this;
  }

  check(value: unknown, path: string, issues: Issue[]): boolean {
    const v = value === true || value === "true" || value === "on";
    if (this.mustBeTrue && !v) issues.push({ path, message: this.trueMessage, code: "must_be_true" });
    return v;
  }
}

class EnumSchema<T extends string> extends Schema<T> {
  private values: readonly T[];
  private message: string;

  constructor(values: readonly T[], message = "Invalid value") {
    super();
    this.values = values;
    this.message = message;
  }

  check(value: unknown, path: string, issues: Issue[]): T {
    if (typeof value === "string" && (this.values as readonly string[]).includes(value)) {
      return value as T;
    }
    issues.push({ path, message: this.message, code: "invalid_value" });
    return this.values[0] as T;
  }
}

class ArraySchema<T> extends Schema<T[]> {
  private rules: Rule<T[]>[] = [];
  private item: Schema<T>;

  constructor(item: Schema<T>) {
    super();
    this.item = item;
  }

  min(n: number, message = `At least ${n} required`): this {
    this.rules.push({ test: (v) => v.length >= n, message, code: "too_short", params: { min: n } });
    return this;
  }

  check(value: unknown, path: string, issues: Issue[]): T[] {
    if (!Array.isArray(value)) {
      issues.push({ path, message: "Must be a list", code: "not_a_list" });
      return [];
    }
    const out = value.map((item, i) => this.item.check(item, `${path}[${i}]`, issues));
    for (const rule of this.rules) {
      if (!rule.test(out)) issues.push({ path, message: rule.message });
    }
    return out;
  }
}

type Shape = Record<string, Schema<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };

class ObjectSchema<S extends Shape> extends Schema<Infer<S>> {
  private shape: S;

  constructor(shape: S) {
    super();
    this.shape = shape;
  }

  check(value: unknown, path: string, issues: Issue[]): Infer<S> {
    const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (!value || typeof value !== "object") issues.push({ path, message: "Must be an object", code: "not_an_object" });
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      out[key] = schema.check(obj[key], path ? `${path}.${key}` : key, issues);
    }
    return out as Infer<S>;
  }
}

export const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  enum: <T extends string>(values: readonly T[], message?: string) => new EnumSchema(values, message),
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  object: <S extends Shape>(shape: S) => new ObjectSchema(shape),
};

export type InferSchema<X> = X extends Schema<infer T> ? T : never;
