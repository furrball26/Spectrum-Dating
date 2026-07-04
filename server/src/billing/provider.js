// Billing provider abstraction — provider-agnostic by design.
//
// A `BillingProvider` is any object with this shape:
//   name                              → string, e.g. 'stub' | 'stripe'
//   createCheckoutSession(userId, tier) → { configured, url? } | Promise<...>
//   cancel(userId)                    → { ok, ... } | Promise<...>
//   handleWebhook(rawBody, headers)   → { ignored? , ... } | Promise<...>
//
// The default is StubProvider: NO charges, NO fake checkout URL, webhooks
// ignored. A real provider (StripeProvider / PaddleProvider / …) implements this
// SAME interface later and is selected by the BILLING_PROVIDER env var — with
// zero changes to feature-gating code, because everything reads getEntitlement.
// The real provider's webhook is the ONLY thing that ever flips a member to a
// paid tier (via setEntitlement with source='stripe'/etc.); until one is wired,
// the only path to Companion is an admin `admin_demo` grant.

// StubProvider — the honest no-provider default.
export const StubProvider = {
  name: 'stub',

  // No provider is configured, so we do NOT invent a checkout URL and we do NOT
  // charge. The frontend renders a calm "payment options are coming soon" state
  // from `configured: false`. We never pretend to charge.
  createCheckoutSession(_userId, _tier) {
    return { configured: false };
  },

  // Local no-op success. There is no external subscription to cancel; the route
  // layer handles reverting an `admin_demo` grant back to free so demo cancels
  // still work.
  cancel(_userId) {
    return { ok: true, canceled: true };
  },

  // No provider → nothing to verify or apply. Ignore every webhook.
  handleWebhook(_rawBody, _headers) {
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
