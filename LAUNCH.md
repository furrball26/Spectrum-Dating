# Spectrum Dating — Launch Readiness

Status legend: ✅ done · 🔴 blocker · 🟡 should-have · ⚪ nice-to-have
Owner: **You** = Taylor (needs your accounts/secrets) · **Dev** = in-code, done or doable by the team.

---

## 🔴 Launch blockers

### 1. ✅ New-user signup + 18+ age gate — VERIFIED
- Registration form, onboarding routing, and the **18+ gate are enforced server-side** (`profile.js:207–218`, confirmed live: under-18 → HTTP 400) and client-side.
- **Your one step:** do a single live signup (create a real test account) end-to-end on the live site to confirm the full submit path, since the team doesn't create accounts programmatically for you.

### 2. 🔴 Photo uploads (Cloudflare R2) — NEEDS YOU (~15 min)
Real users can't upload photos yet; the sample profiles use hot-linked images. The upload code (`uploadIntent`/`confirmAttachment`, presigned PUT) is built and waiting on R2 credentials.
1. Cloudflare dashboard → **R2** → Create bucket (e.g. `spectrum-uploads`).
2. R2 → **Manage API Tokens** → Create token with **Object Read & Write** on that bucket. Copy the Access Key ID + Secret.
3. (Recommended) enable a public dev URL or attach a custom domain to the bucket for serving images.
4. In **Railway → the server service → Variables**, set:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
   (confirm the exact names the server reads in `Spectrum-Dating-Server/src` before setting.)
5. Redeploy. Then re-enable the message photo button (`ATTACHMENTS_ENABLED = true` in `ConversationScreen.jsx`) and verify a profile-photo upload.

### 3. 🔴 Transactional email (verification + resets) — NEEDS YOU (~15 min)
Verification emails won't send without a provider. Pick one (Resend is simplest):
1. Create a **Resend** (or Postmark/SES) account; verify your sending domain (add the DNS records they give you).
2. Create an API key.
3. In **Railway → Variables**, set the email provider key + `EMAIL_FROM` (confirm the exact var names the server expects).
4. Redeploy and trigger a verification email to confirm delivery.

### 4. 🔴 Legal: Terms, Privacy, age statement — DRAFTS PROVIDED, NEED YOUR REVIEW
- Draft `legal/TERMS.md` and `legal/PRIVACY.md` are in this repo. **They are drafts, not legal advice** — have a lawyer review before publishing, especially the dating-specific safety, data-retention, and 18+ clauses.
- Wire them as routes/pages and link them from the landing footer + the signup screen before accepting real users.

---

## 🟡 Should-have before launch
- **Real-device mobile pass** — automated browser can't go below 1920px; test the bottom-nav + responsive layout on an actual phone.
- **Custom domain** — move off `spectrum-dating-eta.vercel.app` (Vercel → Domains; update `ALLOWED_ORIGIN` on the server + any CORS).
- **Error tracking + analytics** — add Sentry (frontend + backend) and a privacy-respecting analytics tool, so production breakage is visible.
- **Production secrets review** — confirm `JWT_SECRET` is a strong random value in prod (not the dev default), and rotate the admin password if it was shared anywhere.

## ⚪ Nice-to-have / deferred (tracked in STATUS.md)
- Reaction-picker arrow-key navigation (a11y).
- Desktop scroll-container cleanup (two competing scrollers — benign).
- Client-side routing (Back/Forward currently full-reloads to Discover).

---

## Pre-launch smoke checklist (run once everything above is set)
- [ ] Live signup → onboarding → first match → first message, on a real phone
- [ ] Upload a profile photo (after R2)
- [ ] Receive a verification email (after email)
- [ ] Report/block a user → appears in Moderation
- [ ] Toggle dim theme + "reduce motion" + "larger text" and walk the core flow
- [ ] Delete account → data removed; signup again with same email works
- [ ] Terms + Privacy links present and load
