-- Billing webhook idempotency ledger (provider-agnostic plumbing).
--
-- Every real payment provider (Stripe, Paddle, …) delivers webhooks AT LEAST
-- once and WILL redeliver the same event on any non-2xx or timeout. Applying the
-- same event twice would double-grant/double-revoke a tier. This table records
-- each processed event's provider-assigned id exactly once; recordBillingEvent()
-- (see billing/entitlements.js) inserts-or-detects-duplicate, and a real
-- provider's handleWebhook() no-ops on a duplicate.
--
-- The PK is (provider, event_id): event ids are only unique WITHIN a provider, so
-- the compound key is the honest uniqueness constraint. No FK to users — an event
-- may reference a customer we can't resolve yet; idempotency must not depend on it.
-- Additive only (head was 059). No real provider is wired yet, so this stays
-- empty until BILLING_PROVIDER is set — it's the safety rail waiting in place.
CREATE TABLE IF NOT EXISTS billing_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  event_type  TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);
