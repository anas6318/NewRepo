/** Problem-reporting form (spec §13). */
import { useState } from "react";
import { useI18n } from "../../lib/i18n/index.tsx";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import type { IssueReport } from "../../services/types.ts";
import { Field } from "../product/ReviewsSection.tsx";

const CATEGORIES: IssueReport["category"][] = [
  "damaged",
  "defective",
  "incorrect_item",
  "incorrect_size_supplied",
  "incorrect_personalization",
  "missing_item",
  "delivery_problem",
  "other",
];

export function IssueReportForm({ orderNumber, defaultContact }: { orderNumber: string; defaultContact?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState("");
  const [contact, setContact] = useState(defaultContact ?? "");
  const [category, setCategory] = useState<IssueReport["category"]>("damaged");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || contact.trim().length < 4 || description.trim().length < 10) {
      setError(t("issues.validation"));
      return;
    }
    setError(null);
    const res = await dataService().submitIssueReport({
      orderNumber,
      name: name.trim(),
      contact: contact.trim(),
      category,
      description: `${description.trim()}${photoName ? `\n[photo attached: ${photoName}]` : ""}`,
      requestedResolution: resolution.trim(),
    });
    if (res.ok) {
      setDone(true);
      toast.push(t("issues.received"));
    }
  };

  if (done) return <p className="badge badge--ok">{t("issues.received")}</p>;

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={t("tracking.reportIssue")}>
      <p className="text-sm text-muted">{t("issues.intro")}</p>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="form-grid">
        <Field id="is-name" label={t("checkout.fullName")} required>
          <input id="is-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="is-contact" label={t("issues.contact")} required>
          <input id="is-contact" className="input" dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field id="is-cat" label={t("issues.category")} required>
          <select id="is-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as IssueReport["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`issues.cat_${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="is-photo" label={t("issues.photo")} hint={t("issues.photoHint")}>
          <input id="is-photo" type="file" accept="image/*" className="input" onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? "")} />
        </Field>
      </div>
      <Field id="is-desc" label={t("issues.description")} required>
        <textarea id="is-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field id="is-res" label={t("issues.resolution")}>
        <input id="is-res" className="input" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={t("issues.resolutionHint")} />
      </Field>
      <button type="submit" className="btn btn--gold" style={{ alignSelf: "flex-start" }}>
        {t("issues.submit")}
      </button>
    </form>
  );
}
