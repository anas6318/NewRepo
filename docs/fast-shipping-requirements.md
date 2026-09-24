# Fast Shipping — what still has to be built

Status: **NOT shippable as a customer-facing claim.** The frontend predicate
exists (`src/lib/fast-shipping.ts`) and returns `false` for the entire
catalog. No badge, filter or collection is rendered anywhere. This is
deliberate — see "Why it was not forced in".

## What "Fast Shipping — up to 3 business days" requires to be true

The promise is about physical stock held locally. It is true only when a unit
of the exact **version + size** the customer selected is already in the
country and can be posted immediately.

## What exists today

| Concern | State |
| --- | --- |
| `AvailabilityRecord` | `available \| confirmation_required \| unavailable \| discontinued` — a record of the last **supplier confirmation**, not inventory |
| `versionAvailability`, `sizeAvailability` | Same four states, per version and per size |
| Quantity anywhere | **None.** No field in `Product`, no table, no column |
| Stock check in `place-order` | **None** |
| Stock decrement / reservation | **None** |
| Concurrency control | **None** |

`available` means "a human confirmed with the supplier recently". Treating it
as stock would put a 3-day promise on made-to-order goods that ship from the
supplier in 10–14 days. That is the specific mistake this module refuses to
make.

## Required backend extension

1. **Storage.** `products.data.localStock` as a jsonb object keyed
   `"<version>:<size>"` → integer units (the shape `stockKey()` already
   produces). Additive; no migration needed for the column itself, since
   `products.data` is already jsonb.

2. **Server-side validation in `place-order`.** For every line whose variant
   claims local stock, re-read the row and confirm `units >= quantity`
   **inside the same transaction** that writes the order. The client must
   never be the authority — it already is not, for price and badges.

3. **Atomic decrement.** A Postgres function that decrements and rejects
   below zero in one statement, e.g.
   `UPDATE products SET data = jsonb_set(...) WHERE (data->'localStock'->>key)::int >= qty RETURNING id`
   — zero rows returned means someone else took the last unit, and the order
   must fail with a clear error rather than overselling. **This is the part
   that needs a migration** (the function, plus a CHECK or a guard that stock
   can never go negative).

4. **Restock on cancellation/refund.** The order lifecycle must return units,
   or stock drifts down permanently.

5. **Admin editing.** A stock field per version+size in the product editor,
   next to the existing availability controls, with an audit entry — the
   owner needs to see and correct counts.

6. **Only then**, the UI: a Fast Shipping badge gated on
   `isFastShippingEligible(product, version, size)` at the selected variant,
   and a collection gated on `fastShippingProducts()`.

## Why it was not forced in

The instruction for this pass was explicit: if a safe implementation needs a
migration or an order/inventory change, do the groundwork, document the rest,
and do not display fake stock claims. Steps 2–4 above are order-lifecycle and
concurrency work — exactly the area that was out of scope. Shipping a badge
driven by anything weaker than real, decremented stock would promise
customers three days on shirts that take two weeks.
