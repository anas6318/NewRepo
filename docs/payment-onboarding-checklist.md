# Payment Onboarding Checklist

- [ ] Choose an Israeli PCI-compliant card gateway and open a merchant
      account (business registration required).
- [ ] Receive API credentials + webhook signing secret; add to Vercel env
      vars (`ISRAELI_GATEWAY_*`).
- [ ] Implement the gateway-specific request/response shape in
      `supabase/functions/payments-webhook/index.ts (israeli-gateway template block)` (see
      `docs/payment-setup.md`).
- [ ] Test in the gateway's sandbox/test mode end-to-end: checkout →
      redirect → webhook → order flips to `payment_confirmed`.
- [ ] Open a PayPal Business account; add `PAYPAL_*` env vars; implement +
      test.
- [ ] If offering Bit/PayBox, obtain an actual business integration (not a
      personal link) from either provider; add env vars; implement + test.
- [ ] Confirm bank account details for bank-transfer instructions
      (`the bank-transfer instructions in Admin → Payments.
- [ ] Enable each method in Admin → Payment settings only after its sandbox
      test passes.
- [ ] Switch `the method’s test-mode flag in Admin → Payments` to `false` for each method
      once verified with a real (small) live transaction.
- [ ] Re-run the checkout Playwright specs (`tests/e2e/05-checkout-tracking.e2e.mjs`)
      against the production-like environment before removing test mode.
