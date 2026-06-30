# Spectrum Dating — Launch Readiness

Status legend: ✅ done · 🔴 blocker · 🟡 should-have · ⚪ nice-to-have
**You** = Taylor (needs your accounts/secrets). **Dev** = handled in code by the team.

---

## ✅ Done on the dev side (live)
- New-user signup + onboarding + **18+ age gate** (enforced server-side, verified).
- **Security**: JWT fail-fast if `JWT_SECRET` unset in prod; `export ?token=` runs the token-version/suspension check; auth rate-limiter keys on safe `req.ip`; socket auth version-checked. (`JWT_SECRET` is already set in prod.)
- **Password reset** — `/auth/forgot-password` + `/auth/reset-password` (1-hour single-use tokens, no email enumeration), "Forgot password?" + request view in sign-in, and the `?reset=` "Choose a new password" screen. *Sends once email (below) is configured.*
- **Download my data** button (Profile) and **Blocked-people list + unblock** (Safety Center).
- Messaging reactions persist on reload; dim-theme contrast + accessibility (WCAG 2.2 AA) pass.
- Daily autonomous QA + accessibility audits report to `STATUS.md`.

---

## 🔴 Your hard blockers (required before real users)

### 1. Email (Resend) — unblocks verification + the password-reset emails  ·  ~15 min
1. Create a [Resend](https://resend.com) account → verify your sending domain (add the DNS records they provide).
2. Create an API key.
3. **Railway → server service → Variables**, set:
   - `RESEND_API_KEY` = your key
   - `EMAIL_FROM` = e.g. `Spectrum Dating <hello@yourdomain.com>`
   - `APP_URL` = your live site URL (used to build links inside emails)
4. Redeploy. Trigger a verification + a password-reset email to confirm delivery.

### 2. Photos (Cloudflare R2) — real users can't upload photos without this  ·  ~15 min
1. Cloudflare → **R2** → create a bucket; enable a public URL (or attach a domain to the bucket).
2. R2 → **Manage API Tokens** → create a token with **Object Read & Write** on the bucket.
3. **Railway → Variables**, set:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`
   - `R2_PUBLIC_URL` (the public base URL images are served from)
   - *(optional)* `R2_BACKUP_BUCKET`
4. Tell the team — we'll flip the photo-upload flag back on (`ATTACHMENTS_ENABLED`) and verify a profile-photo upload.

### 3. Legal — review the drafts
- Fill the bracketed `[…]` fields in `legal/TERMS.md` and `legal/PRIVACY.md` (legal entity name, address, support email).
- Have a lawyer review the 18+, safety, and data-retention/deletion clauses.
- Send back and the team wires them as linked pages (landing footer + signup).

### 4. Custom domain  ·  optional for soft-launch, expected for public launch
1. **Vercel → project → Domains** → add your domain.
2. **Railway → Variables**: `ALLOWED_ORIGIN` = `https://yourdomain.com` (CORS); update `APP_URL` to match.
3. If you also put the backend on a custom domain, update `VITE_API_URL` in **Vercel** to the new API URL.

---

## 🟡 Quick account-level items
- **Admin access**: set `ADMIN_EMAILS` in Railway to your email(s), comma-separated.
- **Security cleanup**: if `RESET_PASSWORD_EMAIL` / `RESET_PASSWORD_VALUE` are set in Railway (boot-time admin-password reset), **unset them** so they don't re-run on every restart. `JWT_SECRET` is already set — no action.
- **One live signup test**: create a real account end-to-end on the live site (the team doesn't create accounts), ideally on a real phone.

## ⚪ Recommended, not blocking
- `VAPID_PUBLIC_KEY` (+ private key) to enable web-push notifications.
- Add Sentry (frontend + backend) for production error tracking.
- Privacy-respecting analytics.

---

## Fastest path to "live"
Do **#1 (email)** and **#2 (R2)** first — they unblock the only features that don't currently work (email delivery + photo uploads). After those, the product is functionally launchable; #3 (legal) and #4 (domain) are the public-launch polish.

## Pre-launch smoke checklist
- [ ] Live signup → onboarding → first match → first message, on a real phone
- [ ] Receive a verification email AND complete a password reset (after #1)
- [ ] Upload a profile photo (after #2)
- [ ] Report + block a user → appears in Moderation; then unblock from Safety Center
- [ ] Toggle dim theme + "reduce motion" + "larger text" and walk the core flow
- [ ] "Download my data" returns your conversations
- [ ] Delete account → data removed; signup again with same email works
- [ ] Terms + Privacy links present and load
