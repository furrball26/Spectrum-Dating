# Round 2 — Post-Fix Regression Smoke

**Date:** 2026-06-30 · **Method:** live pass driven from the main session (the QA subagent was blocked by a Chrome permission denial; ran inline instead). Sample user **Mira K.**, desktop.
**Under test:** frontend `61cc34b` (bundle `index-B1PmTRzs.js`) + backend `0c3fef7`.

## VERDICT: 🟢 CLEAN — no regressions found

Every core flow renders correctly with **zero console errors** and **all API calls 200** after the ~24-item fix sweep touched shared files (`App.jsx`, `api.js`, `MessagingApp`, `SuggestionScreen`).

## Screens smoke-tested (console + network watched on each)
| Screen | Result | Notes |
|---|---|---|
| Discover (`?tab=suggestions`) | ✅ | Card renders (Ana Beltran, Verified, coarse "Near Chicago", bio). `GET /matching/candidates` 200. No console errors. Title "Discover · Spectrum". |
| Messages list | ✅ | 2-pane; **"ACTIVE CONVERSATIONS 1/5"** → E24 server `activeCap` working; Archived section present. |
| Messages thread (Eli) | ✅ | Renders messages + ♥1 reaction + **4 tombstones (integrity intact)** + composer. `GET …?limit=50` 200 → E44 param intact. `read` PUT 200. No console errors. |
| Matches | ✅ | Eli Brenner card, contextCard quote, "Open chat". Title "Matches · Spectrum". |
| Profile editor | ✅ | Completeness 7/8, photo grid (Main/Add/alt-text/Remove), Verified. No console errors. |
| Deep-links / titles | ✅ | `?tab=` cold navigation works on every tab; `document.title` correct per screen. |

## Fixes confirmed
- **E27** — verified separately via API: block w/ reason `inappropriate` → `201 {blocked:true}` (was 400), block took, unblocked to restore.
- **E5** — verified via API: self-block → clean `400 "You cannot block yourself"` (was 500).
- **E24** — live: "1/5" cap is server-driven.
- **E44** — live: `limit=50` param present on conversation fetch.
- Bundle `index-B1PmTRzs.js` (E9/E23/E31/E32/E43 strings) confirmed live by the deploying agent.

## Not exercised live (need fault-injection or irreversible actions)
- E9 (failed-like restore), E32 (self-message unread count), E43 (unsent-discard) — require client-side fetch injection; deferred to avoid over-driving. Code-confirmed in the live bundle.
- E31 realtime `new_match` — needs a real mutual match (irreversible on sample data).

## Sample data
No mutations from this smoke pass (navigation + reads only). The earlier API verification blocked+unblocked one candidate (restored) and self-block (no state change). Eli thread unchanged at 9 messages / 4 tombstones.

~Regression (Leroi, inline)
