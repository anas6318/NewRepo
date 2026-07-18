# Payment Setup

Architecture: checkout shows only methods that are **enabled in admin AND
configured server-side**. `payments-webhook` verifies a signature before
any write and is idempotent on `(provider, provider_event_id)`. Nothing in
the codebase can mark an order paid without a verified event or a staff
member's explicit action. No card data ever touches this app — hosted/
tokenized flows only (spec §14).

**Bank transfer (live today):** customer sees the instructions from admin →
order lands `awaiting_payment` → staff verifies the transfer → sets *paid*
→ pipeline continues + customer email. No integration required.

**Israeli card gateway:** open a merchant account (business registration
required) with a PCI-DSS hosted-checkout provider; set
`ISRAELI_GATEWAY_API_KEY` + `ISRAELI_GATEWAY_WEBHOOK_SECRET` secrets; point
its webhook at
`…/functions/v1/payments-webhook?provider=israeli-gateway`; adapt the
marked TEMPLATE block in `payments-webhook/index.ts` to the provider's real
header/event shape; add the provider's hosted-payment redirect to checkout
(create a `create-payment` edge function returning the redirect URL —
follow the place-order pattern; keep `custom_id`/reference = order number);
test the full sandbox loop; then enable in admin and turn test mode off
after one small live transaction.

**PayPal:** business account → `PAYPAL_CLIENT_ID/SECRET/WEBHOOK_ID`
secrets. The webhook verifier (verify-webhook-signature API) is already
implemented; pass the order number as `custom_id` when creating the order.

**Bit / PayBox:** only via a real *business* integration or an aggregator
that emits signed webhooks — personal payment links must never be presented
as integrated methods. The HMAC template mirrors the gateway block.

Statuses supported end-to-end: pending, awaiting_payment, authorized, paid,
failed, cancelled, refunded, partially_refunded, under_review.
Checklist: `payment-onboarding-checklist.md`.
