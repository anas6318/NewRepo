/** Admin: customers + review moderation (spec §22/§26). */
import { useEffect, useState } from "react";
import { dataService } from "../../services/index.ts";
import { useToast } from "../../services/store.tsx";
import { Stars } from "../../components/ui/bits.tsx";
import type { Customer, Review } from "../../services/types.ts";

export function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");
  const toast = useToast();

  useEffect(() => {
    document.title = "Customers · CROWNED admin";
    dataService()
      .adminListCustomers()
      .then(setCustomers)
      .catch((e) => toast.push(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (customers ?? []).filter((c) => !query || `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="stack stack--lg">
      <h1 className="section__title">Customers {customers && <span className="text-muted">({customers.length})</span>}</h1>
      <input className="input" style={{ maxWidth: 280 }} placeholder="Search customers…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search customers" />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Phone</th>
              <th scope="col">Role</th>
              <th scope="col">Since</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name} {c.isDemo && <span className="badge badge--demo">demo</span>}
                </td>
                <td className="num">{c.email}</td>
                <td className="num">{c.phone ?? "—"}</td>
                <td>
                  <span className={`badge ${c.role === "customer" ? "badge--muted" : "badge--gold"}`}>{c.role}</span>
                </td>
                <td className="num">{new Date(c.createdAt).toLocaleDateString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminReviews() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [filter, setFilter] = useState<"" | Review["status"]>("");
  const toast = useToast();

  const load = () => {
    dataService()
      .adminListReviews()
      .then(setReviews)
      .catch((e) => toast.push(String(e), "error"));
  };
  useEffect(() => {
    document.title = "Reviews · CROWNED admin";
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, status: Review["status"], verified?: boolean) => {
    await dataService().adminModerateReview(id, status, verified);
    toast.push(`Review ${status}`);
    load();
  };

  const filtered = (reviews ?? []).filter((r) => !filter || r.status === filter);
  const pending = (reviews ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <h1 className="section__title">
          Reviews {pending > 0 && <span className="badge badge--warn">{pending} pending</span>}
        </h1>
        <select className="select" style={{ maxWidth: 180 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter by status">
          <option value="">All</option>
          {(["pending", "approved", "rejected", "hidden"] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-muted">Reviews never publish automatically — approve each one explicitly. Demo reviews are labeled and must never reach production.</p>
      <div className="grid-2">
        {filtered.map((r) => (
          <article key={r.id} className="card stack--sm stack">
            <div className="row row--between row--wrap">
              <Stars rating={r.rating} />
              <span className={`badge ${r.status === "approved" ? "badge--ok" : r.status === "pending" ? "badge--warn" : "badge--muted"}`}>{r.status}</span>
            </div>
            <strong>{r.title}</strong>
            <p className="text-sm text-muted" dir={r.locale === "en" ? "ltr" : "rtl"} lang={r.locale}>
              {r.body}
            </p>
            {r.photo && <img src={r.photo} alt="review upload" style={{ width: 120, borderRadius: "var(--r-sm)" }} />}
            <p className="text-xs text-muted">
              {r.displayName} · {r.locale} · {r.productSlug ?? "store"} · {new Date(r.createdAt).toLocaleDateString("en-GB")}
              {r.isDemo && (
                <span className="badge badge--demo" style={{ marginInlineStart: 6 }}>
                  demo
                </span>
              )}
            </p>
            <div className="row row--wrap" style={{ gap: "var(--sp-2)" }}>
              {r.status !== "approved" && (
                <button type="button" className="btn btn--gold btn--sm" onClick={() => void act(r.id, "approved")}>
                  Approve
                </button>
              )}
              {r.status !== "rejected" && (
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void act(r.id, "rejected")}>
                  Reject
                </button>
              )}
              {r.status === "approved" && (
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void act(r.id, "hidden")}>
                  Hide
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void act(r.id, r.status, !r.verified)}>
                {r.verified ? "Unmark verified" : "Mark verified"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
