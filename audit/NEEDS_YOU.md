# Spectrum Dating — "Needs You" brief (blocked on the client)

**As of 2026-07-05.** The in-code build backlog is essentially complete and live. The
items below can't be finished from code alone — they need an account, a key, a vendor
choice, or an infra setting. Grouped by effort.

## 1. Quick config (minutes — unblocks already-built code)
| Set on Railway | Value / source | Effect |
|---|---|---|
| `QA_BYPASS_SECRET` | `9CprQTzEK1MmnA1zAVvb8CH8tP8Y8` | Activates the test-limiter bypass so QA runs stop tripping the 20/15min auth limit. Inert until set; never weakens the prod limit for real users. |
| `RESEND_API_KEY` + `EMAIL_FROM` | Resend account | Turns on verification emails on signup — the sending code is already deployed and waiting. |

## 2. Vercel deploy integration (recurring this session)
Vercel's GitHub webhook dropped deploys repeatedly today (needed manual re-pushes; one stall lasted ~40 min). Everything ships to `master` fine and Railway is unaffected — it's purely Vercel *serving* the new frontend. Check **Vercel → Deployments** for stuck/paused builds and **Settings → Git → reconnect the GitHub integration**.

## 3. Payment provider (makes billing real)
Billing is a provider-agnostic scaffold (a `StubProvider`); the paid tier is fully demoable via the admin "Manual access" toggle. To take real payments:
- Pick a provider (Stripe / Paddle / …), implement it against the `BillingProvider` interface in `server/src/billing/provider.js`, set `BILLING_PROVIDER` + keys in Railway env. **No feature-gating code changes** — everything reads `getEntitlement`.
- **Required security for that phase** (from the billing audit, recorded in `BILLING_ARCHITECTURE.md`): webhook **signature verification over the raw body**, **idempotency** on the event id, and keeping real-provider `source` writes to the verified webhook only.

## 4. Vendor-dependent trust & safety (from MODERATION_GAP_ANALYSIS.md)
These need an external service/account and are the remaining "Critical/Needed" gaps we couldn't close in-code:
- **CSAM hash-match + NCMEC reporting** — integrate a vendor (Thorn "Safer" bundles hash-match + reporting) before scaling image sharing. Legal + child-safety exposure (US law, UK OSA). Highest priority of this group.
- **Unsolicited-image blur** — blur-by-default + view/delete/report (Bumble's "Private Detector" is Apache-open-source; still needs an ML-vision integration + hosting).
- **Ban-evasion friction (phone/SMS verify)** — a suspended user can re-register with a new email today. Needs an SMS vendor (Twilio/…) + basic device signals.
- **Real photo/selfie verification** — the verified badge is currently a manual admin toggle backed by nothing. A privacy-light selfie-pose match (FaceTec/Veriff-class) would back it; keep it optional, store nothing biometric. (Cautionary: mandatory face-liveness conflicts with our privacy-first posture — keep optional.)

## 5. Audio ops follow-ups (infra config — low severity, from the audio security audit)
The audio feature is production-safe; these are defense-in-depth infra settings, not code:
- **L1 — R2 object-size ceiling:** the app validates ≤5 MB before presigning, but `ContentLength` isn't signed, so a bucket-level object-size cap should be set as the real backstop.
- **L2 — GC orphaned uploads:** a presigned PUT never followed by confirm leaves an object with no DB row. Add an **R2 lifecycle rule** on the `profile-audio/` prefix (and the photos prefix) to expire un-referenced objects.
- **M2 — private bucket for voice (optional):** unapproved audio lives in the shared public media bucket behind an unguessable key (same posture as pending photos — not a regression; no member-facing API leaks it). A dedicated **private bucket** for voice (higher PII) served entirely via presigned GET is the honest hardening if desired.

## 6. Product decision still open
- **Enforcement appeal channel:** `mailto:support@spectrum-dating.app` vs an unauth `POST /feedback` endpoint — the actioned-user due-process copy is live; it just needs the channel wired to your choice.

---
*Everything not in this brief is built and live. This is the whole remaining surface that requires you.*
