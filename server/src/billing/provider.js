// Billing provider abstraction — provider-agnostic by design.
//
// A `BillingProvider` is any object with this shape (every method takes `ctx` as
// its FIRST argument — `ctx.db` is the better-sqlite3 handle; a real provider
// needs it to look up a member's provider_ref for cancel and to write
// entitlements + record idempotency from a verified webhook):
//   name                                   → string, e.g. 'stub' | 'stripe'
//   createCheckoutSession(ctx, userId, tier) → { configured, url? } | Promise<...>
//   cancel(ctx, userId)                    → { ok, ... } | Promise<...>
//   handleWebhook(ctx, rawBody, headers)   → { ignored? , ... } | Promise<...>
//     rawBody is the UNPARSED request Buffer (the '/billing/webhook' route is
//     mounted with express.raw() BEFORE the global json parser) so a provider can
//     verify the signature over the exact bytes it was computed on. handleWebhook
//     MUST verify the signature, then call recordBillingEvent(ctx.db, name,
//     eventId) and no-op on a duplicate, then setEntitlement with source=name.
//
// The default is StubProvider: NO charges, NO fake checkout URL, webhooks
// ignored. A real provider (StripeProvider / PaddleProvider / …) implements this
// SAME interface later and is selected by the BILLING_PROVIDER env var — with
// zero changes to feature-gating code, because everything reads getEntitlement.
// The real provider's webhook is the ONLY thing that ever flips a member to a
// paid tier (via setEntitlement with source='stripe'/etc.); until one is wired,
// the only path to Companion is an admin `admin_demo` grant.

// StubProvider — the honest no-provider default. Ignores ctx entirely.
export const StubProvider = {
  name: 'stub',

  // No provider is configured, so we do NOT invent a checkout URL and we do NOT
  // charge. The frontend renders a calm "payment options are coming soon" state
  // from `configured: false`. We never pretend to charge.
  createCheckoutSession(_ctx, _userId, _tier) {
    return { configured: false };
  },

  // Local no-op success. There is no external subscription to cancel; the route
  // layer handles reverting an `admin_demo` grant back to free so demo cancels
  // still work.
  cancel(_ctx, _userId) {
    return { ok: true, canceled: true };
  },

  // No provider → nothing to verify or apply. Ignore every webhook.
  handleWebhook(_ctx, _rawBody, _headers) {
    return { ignored: true };
  },
};

// getProvider() — resolve the active provider from env (default 'stub').
// Structured so adding a real provider is a drop-in: implement the interface,
// register it in PROVIDERS, and set BILLING_PROVIDER=<name> in Railway env.
// Anything not implemented falls back to the stub (never a fake charge).
const PROVIDERS = {
  stub: StubProvider,
  // stripe: StripeProvider,   // ← drop-in later
  // paddle: PaddleProvider,
};

export function getProvider() {
  const name = (process.env.BILLING_PROVIDER || 'stub').toLowerCase();
  return PROVIDERS[name] || StubProvider;
}
