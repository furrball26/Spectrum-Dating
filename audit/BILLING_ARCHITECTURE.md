# Spectrum Dating — Billing & Entitlements Architecture

**Date:** 2026-07-04 · **Status:** Approved to build (client greenlit). Provider-agnostic
scaffold now; a real payment provider (Stripe/Paddle/etc.) is chosen by the client and
slotted in later. **No real payments are wired in this phase.** The paid tier must be
demoable via an admin toggle.

Grounded in `audit/MONETIZATION_STRATEGY.md` (the ethical rules bind here too): safety &
accessibility never paywalled, one honest published price, no dark-pattern billing, no
fabricated urgency. The paid tier is **Spectrum Companion** (~$8.99/mo).

## Design goals
1. **Provider-agnostic.** A `BillingProvider` interface with a default **StubProvider** (no
   charges). A real provider implements the same interface and is selected by env — zero
   changes to feature-gating code when it's added.
2. **Honest with no provider.** With the stub, "Upgrade" does NOT show a fake checkout. It
   shows a calm "payment options coming soon" state. We never pretend to charge.
3. **Demoable.** An admin can grant/revoke Companion on any account (and on their own, for a
   live walkthrough) without a payment — `source = 'admin_demo'`, clearly separable and
   revocable, never conflated with a real subscription.
4. **Separable & reversible.** Demo grants are tagged and can be cleared en masse, mirroring
   the `is_demo` discipline used for demo members.

## Data model — migration `053_subscriptions.sql` (additive; head is 052)
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            TEXT PRIMARY KEY,
  tier               TEXT NOT NULL DEFAULT 'free',    -- 'free' | 'companion'
  status             TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'canceled' | 'past_due'
  source             TEXT NOT NULL DEFAULT 'none',    -- 'none' | 'admin_demo' | 'stripe' | ...
  provider           TEXT,                            -- null until a provider is wired
  provider_ref       TEXT,                            -- external subscription id (future)
  current_period_end TEXT,                            -- future (provider-managed)
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_source ON subscriptions(source);
```
**No row = free.** Never assume a row exists.

## Backend modules
- `server/src/billing/entitlements.js`
  - `TIERS` = `{ free, companion }` and a static **tier catalog** (name, price, feature list —
    copied from the monetization memo; used by `GET /billing/tiers`).
  - `getEntitlement(userId)` → `{ tier, status, source }`, defaulting to free when no row.
  - `setEntitlement(userId, { tier, status, source, provider?, providerRef? })` — upsert.
  - `isCompanion(userId)` convenience.
  - `requirePaid` middleware — for FUTURE paid endpoints: 402/`{ upgrade: true }` when not an
    active Companion. (No paid endpoints gate on it yet; it exists so paid features plug in.)
- `server/src/billing/provider.js`
  - `BillingProvider` interface: `name`, `createCheckoutSession(userId, tier)`,
    `cancel(userId)`, `handleWebhook(rawBody, headers)`.
  - `StubProvider` (default): `createCheckoutSession` → `{ configured: false }` (no charge);
    `cancel` → local no-op; `handleWebhook` → ignored. A real provider (e.g. `StripeProvider`)
    implements the same interface later.
  - `getProvider()` — reads `BILLING_PROVIDER` env (default `'stub'`).

## Endpoints
Member-facing (`requireAuth`):
- `GET  /billing/tiers` — static tier catalog (free + companion, price, features).
- `GET  /billing/me` — the caller's `{ tier, status, source }`.
- `POST /billing/checkout` — `provider.createCheckoutSession`; with the stub returns
  `{ configured: false }` so the UI shows "coming soon" (never a fake charge).
- `POST /billing/cancel` — `provider.cancel`; for an `admin_demo` grant this reverts to free.
- Also fold `tier` into the existing **`GET /profile/me`** payload (and the login/register
  responses next to `isAdmin`) so the app knows the caller's tier on load.

Admin (`requireAuth + requireAdmin`, under the rate-limited `/admin` mount):
- `POST /admin/entitlements` — `{ userId, tier }` → `setEntitlement(userId, { tier,
  source: 'admin_demo', status: 'active' })`. The member-listing demo toggle.
- `POST /admin/entitlements/self` — `{ tier }` → same, on the calling admin's own account, so
  they can flip their own view free↔companion for a live demo.
- (Optional) `DELETE /admin/entitlements/demo` — clear ALL `source='admin_demo'` grants
  (reset after a demo). Mirrors `wipeDemoData`.

## Frontend
- `src/api.js`: `getBillingTiers()`, `getMyEntitlement()` (or read `tier` off `/profile/me`),
  `startCheckout()`, `cancelSubscription()`, `adminSetEntitlement(userId, tier)`,
  `adminSetSelfEntitlement(tier)`.
- **Membership screen** (entry from Settings): shows **Spectrum (Free)** vs **Spectrum
  Companion** with the memo's feature lists + the one honest price. Free users see an
  "Upgrade to Companion" CTA → with the stub provider it opens a calm "Choose how to
  subscribe — payment options are coming soon" note (honest, no fake form). Companion users
  see "You're on Companion" + a plain Manage/Cancel. No countdowns, no "limited time," no
  fake discounts (memo hard rules).
- **Paid state reflected in the app:** a subtle, calm "Companion" marker and a **Companion
  area** listing what's included. Because the paid *features* aren't built yet, this area is
  the visible free-vs-paid difference for the demo — shown as "included with Companion" when
  paid vs a calm locked state (no urgency, no shaming) when free.
- **Admin demo toggle:** in the moderation console — a per-member "Set tier (demo)" control in
  the member listing, AND a prominent "View as: Free / Companion (demo)" self-toggle so the
  admin can walk the client through the paid experience live. Both label the grant as a demo.

## What stays FREE forever (never gate — memo hard rules)
All safety, all accessibility, compatibility matching, messaging, screened intros,
see-who-liked-you, verification, data export, and the static Conversation Companion /
profile-writing scaffolding already shipped. Companion only ever adds *new* comfort/
capability on top.

## Build sequence
1. **Backend** (builder): migration 053 + `entitlements.js` + `provider.js` (stub) +
   endpoints + `/profile/me` tier + `requirePaid` + tests + Railway deploy.
2. **Frontend** (builder): Membership screen + entitlement in app state + Companion
   marker/area + admin demo toggle. Ship pipeline + live-verify.
3. **Review** (backend-security-auditor): entitlement can't be self-granted by a non-admin;
   the admin toggle is admin-gated + rate-limited; `admin_demo` never masquerades as a real
   subscription; no privilege path from a Companion grant to admin.

## Adding a real provider later (client's step)
Implement `StripeProvider` (or Paddle/…) against the `BillingProvider` interface, set
`BILLING_PROVIDER=stripe` + keys in Railway env, and add the webhook route to
`provider.handleWebhook`. No feature-gating code changes — everything already reads
`getEntitlement`.

### MUST-DO security items for the payment phase (from the 4434b77 security audit)
The demo scaffold audited clean (no member self-grant path; admin-gated + rate-limited grants;
tier confers no privilege; allowlisted/parameterized inputs; `requirePaid` fails closed). These
become required the moment a real provider is wired — the webhook is then the ONLY path that
flips a member to a *real* paid tier:
1. **Verify the webhook signature over the RAW body** before calling `setEntitlement`. Note
   `express.json()` already consumes the body app-wide — the webhook route needs a raw-body
   parser branch. An unverified webhook = an unauthenticated self-grant of `source='stripe'`.
2. **Idempotency** — dedupe on the provider event id (use `provider_ref`) so webhook retries
   can't double-apply state.
3. **Restrict real-provider `source` writes to the webhook handler only.** The `SOURCES`
   allowlist permits `'stripe'`/`'paddle'`, but today no route forwards a client-supplied
   `source` (member/admin routes are locked to `'admin_demo'`/`'none'`). Keep it that way —
   only the verified provider layer may persist a real-provider source, so a demo grant can
   never be dressed up as a real subscription.
