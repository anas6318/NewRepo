/**
 * Turns a schema {@link Issue} into text a customer can actually read.
 *
 * The validation library ships English strings ("Must be at least 2
 * characters") because it is a generic utility. Those strings are fine in a
 * log and wrong on an Arabic or Hebrew storefront, and they were reaching
 * customers from the reviews form — and from checkout for every rule the old
 * three-case mapping did not cover.
 *
 * One function, used by every customer-facing form, so a rule added to a
 * schema can never quietly reintroduce an English message.
 */
import type { Issue, IssueCode } from "./schema.ts";
import type { TFunction } from "./i18n/translate.ts";

const KEY: Record<IssueCode, string> = {
  required: "errors.required",
  too_short: "errors.tooShort",
  too_long: "errors.tooLong",
  invalid_format: "errors.invalidFormat",
  invalid_email: "errors.invalidEmail",
  invalid_phone: "errors.invalidPhone",
  not_a_number: "errors.notANumber",
  not_a_whole_number: "errors.notAWholeNumber",
  invalid_value: "errors.invalidValue",
  must_be_true: "errors.mustAccept",
  not_a_list: "errors.invalidValue",
  not_an_object: "errors.invalidValue",
};

/**
 * Localized text for one issue. Falls back to the generic "check this field"
 * message rather than the English original — showing a customer English on an
 * Arabic page is the bug this exists to prevent.
 */
export function localizeIssue(issue: Issue, t: TFunction): string {
  const key = issue.code ? KEY[issue.code] : undefined;
  if (!key) return t("errors.invalidValue");
  const params = issue.params ?? {};
  return t(key, { min: String(params.min ?? ""), max: String(params.max ?? "") });
}

/** Every issue as a `field -> localized message` map, ready for <Field error>. */
export function localizeIssues(issues: readonly Issue[], t: TFunction): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    if (!(issue.path in map)) map[issue.path] = localizeIssue(issue, t);
  }
  return map;
}
