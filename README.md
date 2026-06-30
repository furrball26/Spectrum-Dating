# Spectrum Dating — Frontend

An autism-friendly dating web app. Calm, low-pressure, WCAG 2.2 AA. React + Vite,
plain JavaScript, inline styles only (no Tailwind / CSS files).

- **Live:** https://spectrum-dating-eta.vercel.app
- **Backend:** Railway — see `../Spectrum-Dating-Server/RUNBOOK.md` for the API,
  env vars, deploy, seeding, backups, and moderation.

---

## Stack

- **React 18 + Vite** (plain JS, no TypeScript)
- **Inline styles only** — design tokens live in `src/tokens.js` (single source of
  truth: colours, serif font, etc.). Import `{ t }` from there.
- **Real-time:** `socket.io-client` for live messages, reactions, and the unread badge
- **PWA:** `public/manifest.json` + `public/sw.js` service worker (push notifications)
- **No global state library** — auth token lives in `localStorage`
  (`spectrum_token`, `spectrum_user_id`), read per-call in `src/api.js`

## Local development

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
```

Point the app at a backend with `VITE_API_URL` (defaults to `http://localhost:3001`
in dev, same-origin in prod):

```bash
# .env.local
VITE_API_URL=https://spectrum-dating-server-production.up.railway.app
```

## Build & deploy

```bash
npm run build              # outputs to dist/ — must be clean before deploy
npx vercel --prod --yes    # deploy to Vercel (production alias: spectrum-dating-eta)
```

`VITE_API_URL` is configured in the Vercel project's environment variables.

## Project structure

```
src/
  api.js                 All backend calls + token handling + 401 auto-logout.
                         Normalises a few response shapes (admin reports/stats).
  tokens.js              Shared design tokens (the `t` object).
  App.jsx                Auth gate, tab nav, onboarding gate, email-verify banner,
                         socket-driven unread badge, admin gating, sign-out.
  AuthScreen.jsx         Login / register.
  OnboardingScreen.jsx   3-step first-run wizard (basics -> bio+interests -> comms).
  ProfileScreen.jsx      Profile editing, photo upload, push toggle, delete account.
  SuggestionScreen.jsx   Discovery / swiping, pre-match report modal.
  AdminScreen.jsx        Moderation dashboard (admins only — gated on isAdmin).
  messaging/
    MessagingApp.jsx           Conversation list + routing.
    ConversationScreen.jsx     Thread view: messages, reactions, attachments.
    EmptyConversationState.jsx Personalised conversation starters (from /starters).
    MatchesListScreen.jsx      Match list with photos.
    BlockReportScreen.jsx      Block / report flow.
public/
  manifest.json, sw.js, icon-*.png, icon.svg   PWA assets.
```

## Key behaviours

- **Auth:** 30-day JWT in localStorage. A `401` anywhere clears auth and dispatches
  an `auth:expired` event; `App.jsx` listens and drops to the login screen. Sign-out
  and account deletion also call the server so tokens are revoked server-side.
- **Onboarding gate:** new users (incomplete profile) are held in the wizard before
  reaching the main app; they also can't appear in or use discovery until complete.
- **Accessibility:** every interactive element has a visible focus ring
  (`useFocusable()`), 44px minimum touch targets, `prefers-reduced-motion` respected,
  and live regions announce async state. Reds are reserved for genuinely destructive
  actions.
- **Graceful degradation:** photos, push, email verification, and personalised
  starters all fall back quietly if their backend services aren't configured —
  nothing crashes.

## Accessibility & tone

This product serves neurodivergent users. Keep changes calm and predictable:
no surprise motion, no "they're typing…" pressure, no dark patterns, clear and
literal copy. The guiding principle is *"nothing about us without us"* — automated
checks are a floor, not the finish line; real validation is usability testing with
autistic users. When in doubt, lower the stimulation.
