-- Billing & entitlements (provider-agnostic scaffold; no real payments wired).
-- One row per user who has EVER had a subscription state set. NO row = free
-- (getEntitlement defaults to free/active/none); never assume a row exists.
--   tier    : 'free' | 'companion'
--   status  : 'active' | 'canceled' | 'past_due'
--   source  : 'none' | 'admin_demo' | 'stripe' | ...  (who granted the tier)
--   provider/provider_ref/current_period_end : null until a real provider is wired.
-- Additive only (head was 052). idx on source powers the admin_demo reset sweep.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            TEXT PRIMARY KEY,
  tier               TEXT NOT NULL DEFAULT 'free',
  status             TEXT NOT NULL DEFAULT 'active',
  source             TEXT NOT NULL DEFAULT 'none',
  provider           TEXT,
  provider_ref       TEXT,
  current_period_end TEXT,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_source ON subscriptions(source);
