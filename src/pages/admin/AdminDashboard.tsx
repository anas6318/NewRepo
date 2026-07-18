import { useEffect, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { dataService } from "../../services/index.ts";
import { formatPrice } from "../../lib/i18n/index.tsx";
import type { DashboardStats } from "../../services/types.ts";

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard · CROWNED admin";
    dataService()
      .adminDashboard()
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="field__error">{error}</p>;
  if (!stats) return <div className="skeleton" style={{ height: 300, borderRadius: "var(--r-md)" }} aria-busy="true" />;

  const tiles: { label: string; value: string | number; hint?: string }[] = [
    { label: "Orders today", value: stats.ordersToday },
    { label: "Revenue (paid)", value: formatPrice(stats.revenueIls) },
    { label: "Paid orders", value: stats.paidOrders },
    { label: "Pending payments", value: stats.pendingPayments },
    { label: "Awaiting supplier", value: stats.awaitingSupplier },
    { label: "In production", value: stats.inProduction },
    { label: "Dispatched", value: stats.dispatched },
    { label: "In transit", value: stats.inTransit },
    { label: "Avg. order value", value: formatPrice(stats.avgOrderValueIls) },
    { label: "Customers", value: stats.customerCount },
  ];

  return (
    <div className="stack stack--lg">
      <h1 className="section__title">Dashboard</h1>
      <div className="grid-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="stat-tile">
            <span className="stat-tile__label">{tile.label}</span>
            <span className="stat-tile__value">{tile.value}</span>
            {tile.hint && <span className="stat-tile__hint">{tile.hint}</span>}
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="card stack--sm stack" aria-labelledby="top-products">
          <h2 id="top-products" className="drawer__title">
            Top products
          </h2>
          {stats.topProducts.length === 0 && <p className="text-muted text-sm">No order data yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }} className="stack--sm stack">
            {stats.topProducts.map((p) => (
              <li key={p.slug} className="row row--between text-sm">
                <span>{p.title.en}</span>
                <span className="badge badge--muted">{p.count} sold</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card stack--sm stack" aria-labelledby="top-cats">
          <h2 id="top-cats" className="drawer__title">
            Top categories
          </h2>
          <ul style={{ listStyle: "none", padding: 0 }} className="stack--sm stack">
            {stats.topCategories.map((c) => (
              <li key={c.slug} className="row row--between text-sm">
                <span style={{ textTransform: "capitalize" }}>{c.slug.replace(/-/g, " ")}</span>
                <span className="badge badge--muted">{c.count} items</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="row row--wrap">
        <Link to="/admin/orders" className="btn btn--dark">
          Manage orders
        </Link>
        <Link to="/admin/products" className="btn btn--outline">
          Manage products
        </Link>
        <Link to="/admin/reviews" className="btn btn--outline">
          Moderate reviews
        </Link>
      </div>
    </div>
  );
}
