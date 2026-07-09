# Spectrum Dating — What the client must complete (and why we can't)

_Final handoff review. Everything below needs an **account, an API key, a vendor
choice, an infra setting, a content asset, or a business/legal decision** that
only you can make — none can be finished from code alone. Everything NOT on this
list is built, tested, and deployed._

Ordered by launch impact. ⛔ = blocks launch · ⚠️ = decide before real users · 🔧 = config only.

---

## A. Config that makes already-built code work (minutes each)

| # | Set on Railway | Value / source | Why we can't | Effect until done |
|---|---|---|---|---|
| A1 ⛔ | `ADMIN_EMAILS` | your admin email(s) | It's the immutable root-admin allowlist in your prod env; there's no first-run bootstrap and we can't write your secrets. | **The moderation console is unreachable and no photo can be approved → no new user ever becomes visible.** Dead-on-arrival without it. |
| A2 ⛔ | `RESEND_API_KEY` (+ optional `EMAIL_FROM`, `APP_URL`) | your Resend acct + verified domain | Needs your email vendor account + DNS. | Email verification **and password reset** are dead → any user who forgets their password is **permanently locked out**. **This is the reported "password reset doesn't work" issue — it is a config gap, not a code gap.** |
| A3 ⛔ | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_CONTACT_EMAIL` | generate a VAPID keypair | Keys must live in your prod env. | Push notifications return 503 → users get **zero** match/message pushes (all the subscribe UI works, silently). |
| A4 🔧 | `QA_BYPASS_SECRET` = `9CprQTzEK1MmnA1zAVvb8CH8tP8Y8` | (provided) | Your prod env. Inert until set; never weakens the real limiter. | QA/automation stops tripping the 20/15-min auth limit. **Never set this in a public-facing env.** |

### A2 in detail — turning on password reset & email verification (~10 min)
The full self-service flow is **already built and correct** end-to-end
(`POST /auth/forgot-password` → emails a 1-hour, single-use reset link →
`POST /auth/reset-password`). It is inert **only** because no email provider key
is set (`emailConfigured()` returns false, so the send is a silent no-op). Setting
one key activates **both** password reset and real email-ownership verification —
no code change:
1. Create a **[Resend](https://resend.com)** account and generate an **API key**.
2. **Verify a sending domain** in Resend (add the DNS records they give you), or
   use their `onboarding@resend.dev` sender for testing only.
3. On Railway → service `spectrum-dating-server` → **Variables**, set:
   - `RESEND_API_KEY` — the key from step 1 _(required)_
   - `EMAIL_FROM` — e.g. `Spectrum Dating <no-reply@yourdomain.com>` _(optional;
     defaults to the Resend test sender)_
   - `APP_URL` — _optional; already defaults to the live Vercel URL, which is
     correct for the current deployment_
4. **Redeploy the backend.** Reset + verification emails flow immediately.

Until A2 is done, the **admin-only emergency reset** remains available as a manual
fallback: set `RESET_PASSWORD_EMAIL` + `RESET_PASSWORD_VALUE` on Railway, redeploy
(the new password is applied once on boot), verify the login, then **unset both**.
It is completely inert when the vars are absent.

---

## Recently shipped (no client action needed) ✅
The following customer safety reports were fixed **in code** and are **live** — they
are noted here only so your team knows they're handled and where the logic lives:
- **Inappropriate messages are now hidden by default.** A strong/explicit body is
  flagged server-side (`server/src/utils/messageContent.js`) and rendered
  **collapsed** for the recipient ("Show message" to reveal, then Report). The
  sender gets a calm, non-blocking heads-up. Messages are never blocked or altered
  (calm-by-design).
- **Usernames are screened for profanity** at save time
  (`server/src/utils/nameScreen.js`, whole-word + leetspeak-normalized).
- **Registration now asks users to confirm their email** (typo-guard in
  `src/AuthScreen.jsx`). True email-ownership verification additionally activates
  once **A2** above is set.
- **The moderation console auto-fills the reason for Warn *and* Ban** (per-action
  notices in `server/src/moderation/communityStandards.js`).
- **A Black History Month theme** ("heritage") is available in Settings → Appearance.

## B. Vercel deploy integration ⚠️
Vercel's GitHub webhook intermittently drops/lags frontend deploys (recurring all
project). Everything reaches `master` fine and Railway is unaffected — it's purely
Vercel *serving* the new frontend. **You:** Vercel → Deployments (clear stuck
builds) and Settings → Git → reconnect the GitHub integration. We can't administer
your Vercel project.

## C. Content the client must supply ⛔
- **Landing-page "Who we are" copy is an explicit placeholder** (`src/LandingScreen.jsx`,
  marked "⚠️ PLACEHOLDER CONTENT — the client will supply the real team story").
  It renders to **every first-time visitor.** You must supply the real team/story
  copy (we'll drop it in, or remove the section) — it's your brand voice, not ours.

## D. Payments — business decisions before real revenue ⚠️
Billing is a complete provider-agnostic scaffold (StubProvider + interface +
entitlements + admin demo-toggle + a signature-verifying/idempotent webhook route).
The paid tier is fully demoable today via the admin "Manual access" toggle. To take
real money **you** must:
1. **Choose a provider** (Stripe / Paddle / …) — fees, tax handling, merchant-of-record
   are business calls, not ours. We then implement that one provider against the
   interface (no feature-gating changes) and you add its **API key + webhook signing
   secret + `BILLING_PROVIDER`** to Railway.
2. **Reconcile the Companion feature list with reality** — the published catalog
   currently advertises items that aren't built yet (higher photo cap, short-video
   answers, AI draft/tone help, relocation matching). Before charging, **decide:**
   trim the catalog copy to what ships (advanced filters + best-fits list + audio
   answers), or fund building the rest. Charging for unbuilt features breaks the
   "honest by design" brand. _(We can trim the copy on your say-so.)_
3. **Finalize pricing** — `$8.99/mo` / `$54/yr` are placeholders and there is **no
   annual-plan selection mechanism**; if the "$54/yr" claim stays, an annual price
   must actually exist. Confirm price, whether annual is offered, and any
   concession/pay-what-you-can rate.

## E. Trust & safety vendors ⚠️ (needed before scaling media among strangers)
Each needs an external service/account (and, for CSAM, legal registration in your
name) — we can't sign up or transmit data on your behalf.
| Vendor need | Why it's yours | Priority |
|---|---|---|
| **CSAM hash-match + NCMEC reporting** (e.g. Thorn "Safer") | Legal obligation tied to YOUR entity; NCMEC reporting requires your registration. Highest exposure (US law, UK OSA). | **Critical before public launch** |
| **Unsolicited-image blur** (ML vision) | Needs a hosted ML endpoint / vendor account. | High |
| **Phone/SMS verification** (Twilio/…) — ban-evasion friction | A reported-not-yet-actioned user can self-delete & re-register with the same email today (no evasion ledger). Needs an SMS vendor. | High |
| **Selfie/photo verification** to back the "Verified" badge | The badge is a manual toggle backed by nothing today; either wire a privacy-light selfie match (FaceTec/Veriff-class, keep optional) **or hide the badge until it exists.** | Medium |

## F. Operations decisions ⚠️
- **Photo-approval throughput/staffing.** Every new user is invisible until an admin
  manually approves their first photo — no auto-approve, no SLA. At any real signup
  rate this is a human bottleneck. **Decide:** a moderator rotation/staffing plan, or
  buy the auto-moderation vendor (E) to auto-clear the safe majority.
- **Demo/test data in production Discover.** ~500 demo profiles are intentionally live
  in the deck, and **founder test accounts with troll names/pronouns ("Dipshit",
  "Shit/shat/shart") are currently a real new user's first card.** Before real users:
  purge test/troll accounts (we can run the admin wipe) and decide whether the 500
  demo personas stay (they cushion cold-start but can't truly reciprocate). Business
  call. _(Related product fixes — name/pronoun screening — are on our backlog.)_
- **Enforcement appeal channel.** Due-process copy is live and points to
  `support@spectrum-dating.app` (confirm that inbox exists and is monitored — it
  differs from the app domain). If you'd rather an in-app appeal form than email,
  tell us and we'll wire it.

## G. Legal ⛔
- **Terms of Service legal review.** We drafted a plain-language, mission-transparent
  ToS (in repo + in-app). It is **not legal advice.** Your **counsel** must review —
  especially §4.5 (minors / NCMEC), §§8–9 (liability / arbitration / governing law),
  and data-retention — before it's your binding published Terms.

## H. Infra hardening 🔧 (defense-in-depth; config, not code)
- **R2 object-size ceiling** on the media bucket (app caps ≤5 MB pre-sign; bucket cap
  is the real backstop).
- **R2 lifecycle rule** to expire orphaned uploads (`profile-audio/` + photos prefix).
- **(Optional) dedicated private bucket** for voice notes (higher PII).

---
_Anything not listed here is implemented, tested, and live. This is the complete
set of remaining items that genuinely require you._
