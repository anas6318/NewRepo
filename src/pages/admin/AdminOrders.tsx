/** Admin: order management (spec §26). */
import { useEffect, useMemo, useState } from "react";
import { Link } from "../../lib/router.tsx";
import { dataService } from "../../services/index.ts";
import { useToast, useSettings } from "../../services/store.tsx";
import { formatPrice } from "../../lib/i18n/index.tsx";
import { whatsappLink } from "../../lib/whatsapp.ts";
import type { FulfillmentStatus, Order, PaymentStatus } from "../../services/types.ts";

const PAYMENT_STATUSES: PaymentStatus[] = ["pending", "awaiting_payment", "authorized", "paid", "failed", "cancelled", "refunded", "partially_refunded", "under_review"];
const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  "order_received",
  "awaiting_payment",
  "payment_confirmed",
  "sent_to_supplier",
  "production_started",
  "supplier_processing",
  "supplier_dispatched",
  "in_transit",
  "arrived_locally",
  "out_for_delivery",
  "delivered",
  "issue_reported",
  "cancelled",
  "refunded",
];

export function AdminOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState("");
  const [fulfillment, setFulfillment] = useState("");
  const toast = useToast();

  useEffect(() => {
    document.title = "Orders · CROWNED admin";
    dataService()
      .adminListOrders()
      .then(setOrders)
      .catch((e) => toast.push(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      (orders ?? []).filter(
        (o) =>
          (!payment || o.paymentStatus === payment) &&
          (!fulfillment || o.fulfillmentStatus === fulfillment) &&
          (!query || `${o.orderNumber} ${o.customer.name} ${o.customer.email} ${o.customer.phone}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [orders, query, payment, fulfillment],
  );

  const exportCsv = () => {
    const header = "order_number,date,customer,email,phone,city,total_ils,payment_method,payment_status,fulfillment_status";
    const rows = filtered.map((o) =>
      [o.orderNumber, o.createdAt, o.customer.name, o.customer.email, o.customer.phone, o.customer.city, o.totalIls, o.paymentMethod, o.paymentStatus, o.fulfillmentStatus]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([`${header}\n${rows.join("\n")}`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crowned-orders.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack stack--lg">
      <div className="row row--between row--wrap">
        <h1 className="section__title">Orders {orders && <span className="text-muted">({orders.length})</span>}</h1>
        <button type="button" className="btn btn--outline btn--sm" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      <div className="row row--wrap">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search number / customer…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search orders" />
        <select className="select" style={{ maxWidth: 200 }} value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment status">
          <option value="">All payment states</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="select" style={{ maxWidth: 220 }} value={fulfillment} onChange={(e) => setFulfillment(e.target.value)} aria-label="Fulfillment status">
          <option value="">All fulfillment states</option>
          {FULFILLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Customer</th>
              <th scope="col">Total</th>
              <th scope="col">Payment</th>
              <th scope="col">Fulfillment</th>
              <th scope="col">Sheets</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong className="num">{o.orderNumber}</strong>
                  <br />
                  <span className="text-xs text-muted">{new Date(o.createdAt).toLocaleString("en-GB")}</span>
                  {o.isDemo && <span className="badge badge--demo" style={{ marginInlineStart: 6 }}>demo</span>}
                </td>
                <td>
                  {o.customer.name}
                  <br />
                  <span className="text-xs text-muted num">{o.customer.phone}</span>
                </td>
                <td className="num">{formatPrice(o.totalIls)}</td>
                <td>
                  <PayBadge status={o.paymentStatus} />
                </td>
                <td>
                  <span className="badge badge--info">{o.fulfillmentStatus}</span>
                </td>
                <td>
                  <span className={`badge ${o.sheetsSync.status === "synced" ? "badge--ok" : o.sheetsSync.status === "failed" ? "badge--err" : "badge--muted"}`}>{o.sheetsSync.status}</span>
                </td>
                <td>
                  <Link to={`/admin/orders/${o.orderNumber}`} className="btn btn--outline btn--sm">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayBadge({ status }: { status: PaymentStatus }) {
  const cls = status === "paid" ? "badge--ok" : ["failed", "cancelled"].includes(status) ? "badge--err" : ["awaiting_payment", "pending", "under_review"].includes(status) ? "badge--warn" : "badge--muted";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function AdminOrderView({ orderNumber }: { orderNumber: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [notes, setNotes] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [eta, setEta] = useState("");
  const toast = useToast();
  const { settings } = useSettings();

  const load = () => {
    dataService()
      .adminListOrders()
      .then((all) => {
        const found = all.find((o) => o.orderNumber === orderNumber) ?? null;
        setOrder(found);
        if (found) {
          setNotes(found.internalNotes ?? "");
          setSupplierRef(found.supplierReference ?? "");
          setTrackingNumber(found.trackingNumber ?? "");
          setTrackingUrl(found.trackingUrl ?? "");
          setEta(found.estimatedDeliveryAt?.slice(0, 10) ?? "");
        }
      })
      .catch((e) => toast.push(String(e), "error"));
  };
  useEffect(() => {
    document.title = `${orderNumber} · CROWNED admin`;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  if (!order) return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;

  const update = async (patch: Parameters<ReturnType<typeof dataService>["adminUpdateOrder"]>[1]) => {
    const res = await dataService().adminUpdateOrder(orderNumber, patch);
    if (res.ok) {
      toast.push("Updated");
      load();
    } else toast.push("Update failed", "error");
  };

  const resync = async () => {
    const res = await dataService().adminResyncOrder(orderNumber);
    toast.push(res.message, res.ok ? "info" : "error");
    load();
  };

  return (
    <div className="stack stack--lg" style={{ maxWidth: 980 }}>
      <div className="row row--between row--wrap">
        <h1 className="section__title num">{order.orderNumber}</h1>
        <div className="row row--wrap">
          <a className="btn btn--outline btn--sm" href={whatsappLink(order.customer.phone, order.locale, { intent: "general" })} target="_blank" rel="noreferrer">
            WhatsApp customer
          </a>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => void resync()}>
            Resync to Sheets
          </button>
        </div>
      </div>

      <div className="grid-2">
        <section className="card stack--sm stack" aria-label="Customer">
          <h2 className="drawer__title">Customer</h2>
          <p className="text-sm">
            {order.customer.name}
            <br />
            <bdi className="num">{order.customer.email}</bdi>
            <br />
            <bdi className="num">{order.customer.phone}</bdi>
            <br />
            {order.customer.city} — {order.customer.address}
          </p>
          {order.customer.notes && <p className="text-sm text-muted">“{order.customer.notes}”</p>}
          <p className="text-xs text-muted">Language: {order.locale} · Zone: {order.zoneId} · Sheets: {order.sheetsSync.status}{order.sheetsSync.error ? ` — ${order.sheetsSync.error}` : ""}</p>
        </section>

        <section className="card stack--sm stack" aria-label="Items">
          <h2 className="drawer__title">Items</h2>
          <ul style={{ listStyle: "none", padding: 0 }} className="stack--sm stack">
            {order.items.map((item, i) => (
              <li key={i} className="row row--between text-sm">
                <span>
                  {item.title.en} ×{item.quantity} — {item.size}
                  {item.version ? ` · ${item.version}` : ""}
                  {item.personalization ? ` · ${item.personalization.name ?? ""} ${item.personalization.number ?? ""}` : ""}
                  {item.patchName ? ` · ${item.patchName.en}` : ""}
                </span>
                <span className="num">{formatPrice(item.lineTotalIls)}</span>
              </li>
            ))}
          </ul>
          <div className="row row--between text-sm">
            <span className="text-muted">Delivery</span>
            <span className="num">{order.freeDelivery ? "FREE" : formatPrice(order.deliveryIls)}</span>
          </div>
          <div className="row row--between" style={{ fontWeight: 800 }}>
            <span>Total</span>
            <span className="num">{formatPrice(order.totalIls)}</span>
          </div>
        </section>
      </div>

      <section className="card stack" aria-label="Status management">
        <h2 className="drawer__title">Status</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Payment status</span>
            <select className="select" value={order.paymentStatus} onChange={(e) => void update({ paymentStatus: e.target.value as PaymentStatus })}>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {order.paymentMethod === "bank_transfer" && order.paymentStatus === "awaiting_payment" && (
              <span className="field__hint">Bank transfer: verify the payment manually, then set to “paid”.</span>
            )}
          </label>
          <label className="field">
            <span className="field__label">Fulfillment status</span>
            <select className="select" value={order.fulfillmentStatus} onChange={(e) => void update({ fulfillmentStatus: e.target.value as FulfillmentStatus })}>
              {FULFILLMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Supplier reference</span>
            <input className="input num" dir="ltr" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} onBlur={() => void update({ supplierReference: supplierRef })} />
          </label>
          <label className="field">
            <span className="field__label">Tracking number</span>
            <input className="input num" dir="ltr" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} onBlur={() => void update({ trackingNumber })} />
          </label>
          <label className="field">
            <span className="field__label">Tracking URL</span>
            <input className="input num" dir="ltr" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} onBlur={() => void update({ trackingUrl })} />
          </label>
          <label className="field">
            <span className="field__label">Estimated delivery</span>
            <input className="input num" type="date" value={eta} onChange={(e) => setEta(e.target.value)} onBlur={() => eta && void update({ estimatedDeliveryAt: new Date(eta).toISOString() })} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Internal notes (never shown to the customer)</span>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void update({ internalNotes: notes })} />
        </label>
      </section>

      <section className="card stack--sm stack" aria-label="History">
        <h2 className="drawer__title">Timeline</h2>
        <ol className="timeline" style={{ padding: 0 }}>
          {order.tracking.map((ev, i) => (
            <li key={i} className={i === order.tracking.length - 1 ? "is-current" : "is-done"}>
              <span className="timeline__dot" />
              <p className="timeline__label">{ev.status}</p>
              <p className="timeline__meta">{new Date(ev.at).toLocaleString("en-GB")}</p>
            </li>
          ))}
        </ol>
        {settings && order.paymentMethod === "bank_transfer" && <p className="text-xs text-muted">Bank-transfer instructions shown to customer: “{settings.bankTransferInstructions.en.slice(0, 120)}…”</p>}
      </section>
    </div>
  );
}
