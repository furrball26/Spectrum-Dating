// api.js — Spectrum Dating API client
// All calls to the backend go through this module.
// Token is read from localStorage on every call — no global state.

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");

// ─── Token helpers ─────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem("spectrum_token") || null;
}

export function getUserId() {
  return localStorage.getItem("spectrum_user_id") || null;
}

export function setAuth(token, userId) {
  localStorage.setItem("spectrum_token", token);
  localStorage.setItem("spectrum_user_id", userId);
}

export function clearAuth() {
  localStorage.removeItem("spectrum_token");
  localStorage.removeItem("spectrum_user_id");
  // Clear cached profile so identity-derived UI (e.g. the match-moment "you"
  // avatar) can never carry a previous account's name into a new session.
  localStorage.removeItem("spectrum_profile");
  // Identity-flag themes (pride/trans) reset to the neutral default on
  // sign-out: a themed LOGIN page on a shared family computer is an outing
  // vector with no account access needed. Other a11y prefs (motion, text
  // size, light/dim) rightly keep persisting.
  try {
    const a = JSON.parse(localStorage.getItem("spectrum_a11y") || "null");
    if (a && (a.theme === "pride" || a.theme === "trans")) {
      a.theme = "dim";
      localStorage.setItem("spectrum_a11y", JSON.stringify(a));
      if (typeof document !== "undefined") document.documentElement.dataset.theme = "dim";
    }
  } catch { /* prefs unreadable — nothing to reset */ }
}

export function isLoggedIn() {
  return !!getToken();
}

// ─── Core fetch wrapper ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = {}; }
    // 401 — token expired or invalid; clear auth and signal the app to show login
    if (res.status === 401) {
      clearAuth();
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    const err = new Error(errBody.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = errBody.code || null;
    err.body = errBody; // full response body, so callers can read extra fields
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

// ─── Safe error display ─────────────────────────────────────────────────────────
// The fetch wrapper sets err.message to the raw backend `error` string. Some of
// those are already calm, user-facing copy (wrong-password, cap-reached, etc.);
// others are developer-grade validation strings (e.g. "candidateId is required.")
// that must NEVER render to a user. `safeErrorMessage` gates this: it surfaces
// err.message ONLY when the error is recognised as user-safe — either it carries
// a known error `code`, or its exact text is on the allowlist of already-friendly
// backend messages below. Anything unrecognised falls back to the calm generic.
//
// To allow a new backend message, add its EXACT string here (or give it a code).
const KNOWN_ERROR_CODES = new Set([
  "CAP_REACHED",
  "CONVERSATION_ENDED",
  "CONSENT_GATE",
  // Message-request pending cap (422) — the sender's OWN state, calm to surface.
  "PENDING_CAP",
]);

const SAFE_ERROR_MESSAGES = new Set([
  // auth.js
  "Email and password are required.",
  "Invalid email address.",
  "Password must be at least 8 characters.",
  "We couldn’t create an account with those details. If you already have an account, try signing in or resetting your password.",
  "Invalid email or password.",
  "This account has been suspended. Contact support.",
  // Needed #11 — enforcement fallbacks (the enforced screen normally handles
  // these, but keep the plain strings user-safe if the fallback path is hit).
  "This account has been suspended.",
  "This account has been permanently removed.",
  "Token and new password are required.",
  "This reset link is invalid or has expired.",
  "Verification link has expired. Please request a new one.",
  // account.js
  "Current and new password are required.",
  "Please choose a password with at least 8 characters.",
  "That current password doesn't match. Please check it and try again.",
  "New email and current password are required.",
  "That email address doesn't look complete. Please check it.",
  "That's already your email address — no change needed.",
  "We couldn’t change your email to that address. Please try a different one.",
  // messageRequests.js — an intro the sender wrote is their OWN text, so the
  // 400 screening messages are safe (and helpful) to surface verbatim.
  "Your intro needs to be between 1 and 300 characters.",
  "Please rewrite your intro without that language.",
  "For everyone’s safety, a first message can’t include links, contact details, or anything about money or payments. Please introduce yourself without those.",
]);

// Returns a message safe to show a user: err.message when recognised (known code
// or allowlisted text), else the provided calm fallback. Never leaks a raw
// developer/validation string.
export function safeErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  // JRN-4 — a 429 (rate limit) from any endpoint. The backend's own copy names a
  // specific "15 minutes" window (mild urgency/countdown); we never surface a
  // countdown. Calm, non-urgent phrasing instead — display copy only.
  if (err && err.status === 429) {
    return "You've tried a few times in a row. Please take a short break and try again a little later.";
  }
  if (err && err.code && KNOWN_ERROR_CODES.has(err.code)) return err.message || fallback;
  if (err && typeof err.message === "string" && SAFE_ERROR_MESSAGES.has(err.message)) return err.message;
  return fallback;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export async function register(email, password) {
  const data = await apiFetch("/auth/register", {
    method: "POST",
    body: { email, password },
  });
  setAuth(data.token, data.userId);
  return data;
}

export async function login(email, password) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setAuth(data.token, data.userId);
  return data;
}

export async function verifyEmail(token) {
  return apiFetch(`/auth/verify?token=${encodeURIComponent(token)}`);
}

export async function resendVerification() {
  return apiFetch('/auth/resend-verification', { method: 'POST' });
}

export async function signOut() {
  try {
    await apiFetch('/auth/sign-out', { method: 'POST' });
  } catch {
    // Best-effort — always clear local auth regardless
  } finally {
    clearAuth();
  }
}

// Password reset (no auth). forgotPassword always resolves the same way whether
// or not the email exists (the server doesn't reveal account existence).
export async function forgotPassword(email) {
  return apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
}

export async function resetPassword(token, password) {
  return apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } });
}

// Logged-in account changes.
export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch('/account/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  // Keep this session signed in with the fresh token (others are invalidated).
  if (res?.token) localStorage.setItem('spectrum_token', res.token);
  return res;
}

export async function changeEmail(newEmail, currentPassword) {
  return apiFetch('/account/change-email', { method: 'POST', body: { newEmail, currentPassword } });
}

// ─── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile() {
  return apiFetch("/profile/me");
}

// A matched person's public profile (read-only). 403 if not matched.
export async function getUserProfile(userId) {
  return apiFetch(`/profile/${encodeURIComponent(userId)}`);
}

export async function updateProfile(fields) {
  return apiFetch("/profile/me", { method: "PUT", body: fields });
}

// Traveler / at-risk region check. The backend looks up the caller's COARSE
// country from their IP for THIS request only and returns { atRisk, country }
// without storing or logging anything (see server/src/routes/profile.js). Used
// to offer the member the option to hide their profile in a region where
// LGBTQ+ people can face legal risk. Protective, not tracking.
export async function getRegionSafety() {
  return apiFetch("/profile/region-safety");
}

// Self-serve identity-verification request (backlog #11).
// Idempotent — safe to call even if a request already exists.
export async function requestVerification() {
  return apiFetch("/profile/verification-request", { method: "POST" });
}

// Hinge-style profile prompts
export async function getPromptCatalog() {
  const d = await apiFetch('/profile/prompt-catalog');
  return Array.isArray(d?.prompts) ? d.prompts : [];
}

export async function savePrompts(prompts) {
  const d = await apiFetch('/profile/prompts', { method: 'PUT', body: { prompts } });
  return Array.isArray(d?.prompts) ? d.prompts : [];
}

// ─── Matching ─────────────────────────────────────────────────────────────────

export async function getCandidates() {
  return apiFetch("/matching/candidates");
}

export async function swipe(candidateId, decision) {
  return apiFetch("/matching/swipe", {
    method: "POST",
    body: { candidateId, decision },
  });
}

export async function undoSkip() { return apiFetch('/matching/undo-skip', { method: 'POST' }); }

// Undo the caller's most-recent "I'm interested" (like). Pass the specific
// candidateId to reverse that exact card (recommended); omit it to undo the
// most-recent pending like. Mirrors undoSkip's shape.
// → 200 { ok: true, candidateId } — like removed; person returns to Discover.
// → 200 { ok: false }            — nothing to undo (already undone / not owner).
// → 409 { matched: true, error } — the like already became a mutual match;
//   refused (match intact). Surfaced to callers via err.status === 409 /
//   err.body.matched so they can show the "unmatch from the conversation" path.
export async function undoLike(candidateId) {
  return apiFetch('/matching/undo-like', {
    method: 'POST',
    body: candidateId ? { candidateId } : {},
  });
}

// Activity inbox — incoming likes + recent matches.
export async function getActivity() {
  const d = await apiFetch('/matching/activity');
  return {
    incomingLikes: Array.isArray(d?.incomingLikes) ? d.incomingLikes : [],
    recentMatches: Array.isArray(d?.recentMatches) ? d.recentMatches : [],
  };
}

export async function getMatches() {
  const data = await apiFetch("/matching/matches");
  return Array.isArray(data) ? data : (Array.isArray(data?.matches) ? data.matches : []);
}

// Permanently unmatch: removes the match AND its conversation. The other person
// is not notified.
export async function unmatchConversation(matchId) {
  return apiFetch(`/matching/matches/${matchId}`, { method: "DELETE" });
}

// Save (or clear, with "") the viewer's OWN private "note to self" on a match.
// Owner-only — the other person never sees this. Returns { ok, note }.
export async function saveMatchNote(matchId, note) {
  return apiFetch(`/matching/matches/${matchId}/note`, {
    method: "PUT",
    body: { note },
  });
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function normaliseConversationList(arr) {
  return arr.map(({ hasUnread, ...c }) => ({
    ...c,
    // The list UI keys/selects/archives on `conversationId`, but the server
    // returns the conversation under `id` — alias it so row clicks resolve.
    conversationId: c.conversationId ?? c.id,
    lastMessageLabel: c.lastMessageLabel ?? c.lastMessageGroup ?? null,
    // F23 — last-message wayfinding fields. The server sends these directly; we
    // pin them here (with null/false defaults) so the list rows can rely on them
    // even if the spread above is ever narrowed to a whitelist.
    lastMessageSnippet: c.lastMessageSnippet ?? null,
    lastMessageSenderId: c.lastMessageSenderId ?? null,
    lastMessageDeleted: c.lastMessageDeleted ?? false,
    lastMessageAt: c.lastMessageAt ?? null,
    // Canonical unread flag: map the server's `hasUnread` into `unread` here so
    // every consumer reads one field. The raw `hasUnread` is intentionally not
    // spread through — `unread` is the single source of truth.
    unread: c.unread ?? hasUnread ?? false,
    started: c.started ?? (c.lastMessageGroup != null),
  }));
}

export async function getConversations() {
  const data = await apiFetch("/messaging/conversations");
  // Server returns { conversations: [...], activeCap, activeCount, capReached, archivedCount }
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : []);
  return {
    conversations: normaliseConversationList(arr),
    archivedCount: data?.archivedCount ?? 0,
    // Server-authoritative active-conversation cap (falls back to 5 if absent).
    activeCap: data?.activeCap ?? 5,
  };
}

export async function getArchivedConversations() {
  const data = await apiFetch("/messaging/conversations/archived");
  const arr = Array.isArray(data?.conversations) ? data.conversations : [];
  return normaliseConversationList(arr);
}

export async function unarchiveConversation(conversationId) {
  return apiFetch(`/messaging/conversations/${conversationId}/unarchive`, { method: 'POST' });
}

export async function getConversation(id, { limit, before } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (before) params.set('before', before);
  const qs = params.toString();
  return apiFetch(`/messaging/conversations/${id}${qs ? `?${qs}` : ''}`);
}

export async function createConversation(matchId) {
  return apiFetch("/messaging/conversations", {
    method: "POST",
    body: { matchId },
  });
}

// sendMessage accepts either a plain string body (legacy callers) or an options
// object { body, attachmentId }. The backend permits an empty body only when a
// valid attachmentId is present.
export async function sendMessage(conversationId, bodyOrOptions) {
  const opts =
    typeof bodyOrOptions === "string" || bodyOrOptions == null
      ? { body: bodyOrOptions }
      : bodyOrOptions;
  const payload = {};
  if (opts.body != null && opts.body !== "") payload.body = opts.body;
  if (opts.attachmentId) payload.attachmentId = opts.attachmentId;
  const res = await apiFetch(`/messaging/conversations/${conversationId}/messages`, {
    method: "POST",
    body: payload,
  });
  // Server returns { messageId, timeLabel, attachment? }; expose `id` so callers
  // can adopt it, and pass the hydrated attachment through untouched.
  return { ...res, id: res.id ?? res.messageId };
}

export async function deleteMessage(conversationId, messageId) {
  return apiFetch(`/messaging/conversations/${conversationId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export async function archiveConversation(conversationId) {
  return apiFetch(`/messaging/conversations/${conversationId}/archive`, {
    method: "POST",
  });
}

export async function markConversationRead(conversationId) {
  return apiFetch(`/messaging/conversations/${conversationId}/read`, { method: 'PUT' });
}

// The block endpoint only accepts a fixed set of reasons
// (harassment, spam, fake_profile, other). Report reasons are free-text and
// include values the block endpoint rejects (e.g. "inappropriate"), which would
// 400 and — historically — silently fail to block. Canonicalise here at the one
// boundary so every caller's block succeeds regardless of the report reason.
const VALID_BLOCK_REASONS = new Set(["harassment", "spam", "fake_profile", "other"]);
export function canonicalBlockReason(reason) {
  if (VALID_BLOCK_REASONS.has(reason)) return reason;
  // Map known report-only reasons to the closest valid block reason.
  if (reason === "fake") return "fake_profile";
  // Everything else (including "inappropriate") falls back to "other" so the
  // block still lands.
  return "other";
}

export async function blockUser(blockedUserId, reason, details) {
  return apiFetch("/messaging/block", {
    method: "POST",
    body: { blockedUserId, reason: canonicalBlockReason(reason), details },
  });
}

export async function getBlockedUsers() {
  const data = await apiFetch("/messaging/blocked");
  return Array.isArray(data?.blocked) ? data.blocked : [];
}

export async function unblockUser(userId) {
  return apiFetch(`/messaging/blocked/${userId}`, { method: "DELETE" });
}

// ─── Moderation / admin ─────────────────────────────────────────────────────────

export async function getAdminMe() { return apiFetch('/admin/me'); }

// The backend returns reports nested ({ reports: [{ reporter:{...}, reported:{...} }] }).
// AdminScreen consumes a flat array — normalise here so the two halves agree.
export async function getAdminReports(status = 'open') {
  const data = await apiFetch(`/admin/reports?status=${encodeURIComponent(status)}`);
  const arr = Array.isArray(data) ? data : (data?.reports || []);
  return arr.map((r) => ({
    ...r,
    reporterName: r.reporter?.displayName || r.reporterName || '',
    reportedName: r.reported?.displayName || r.reportedName || '',
    reportedEmail: r.reported?.email || r.reportedEmail || '',
    reportedSuspended: r.reported?.suspended ?? r.reportedSuspended ?? false,
    reportedVerified: r.reported?.verified ?? r.reportedVerified ?? false,
    // Needed #7 — enforcement ladder state on the report card: PERMANENT ban,
    // warning tally, and the latest due-process notice (kind + reason + when).
    reportedBanned: r.reported?.banned ?? r.reportedBanned ?? false,
    reportedWarnCount: r.reported?.warnCount ?? r.reportedWarnCount ?? 0,
    reportedLatestNotice: r.reported?.latestNotice ?? r.reportedLatestNotice ?? null,
    // B-C resolute receipt fields — who/when/why a non-open report was resolved.
    resolvedBy: r.resolvedBy || null,
    resolvedAt: r.resolvedAt ?? null,
    moderatorNote: r.moderatorNote || '',
    // P1-A durable snapshot of the reported message (fallback when the live
    // conversation is gone).
    reportedMessage: r.reportedMessage || null,
    // Needed #10 — the specific message the reporter pinned (null on the
    // no-message report path). Shown on the card, distinct from the snapshot.
    reportedPinnedMessage: r.pinnedMessage || null,
    // P1-B repeat-offender signal. reportCount is the TOTAL reports against this
    // member (incl. the current one); actionedCount how many were actioned;
    // blockedByCount distinct members who blocked them; createdAt account age.
    reportedReportCount: r.reported?.reportCount ?? 0,
    reportedActionedCount: r.reported?.actionedCount ?? 0,
    reportedBlockedByCount: r.reported?.blockedByCount ?? 0,
    reportedChatSignalCount: r.reported?.chatSignalCount ?? 0,
    reportedCreatedAt: r.reported?.createdAt ?? null,
  }));
}

export async function resolveReport(id, status, note) { return apiFetch(`/admin/reports/${id}/resolve`, { method: 'POST', body: { status, note } }); }

// A suspend requires a moderator note (backend 400s without one); unsuspend does
// not. Only send `note` when provided so unsuspend stays a clean no-op body.
export async function suspendUser(userId, suspended, note) {
  const body = { suspended };
  if (note) body.note = note;
  return apiFetch(`/admin/users/${userId}/suspend`, { method: 'POST', body });
}

// Needed #7 — enforcement ladder. All three require a moderator note (backend
// 400s without one). Warn records a due-process notice WITHOUT locking the user
// out; ban is a PERMANENT lockout (force-logout, distinct from suspend); unban
// reverses it. 409 on re-ban / not-banned no-ops.
export async function warnUser(userId, note) {
  return apiFetch(`/admin/users/${userId}/warn`, { method: 'POST', body: { note } });
}
export async function banUser(userId, note) {
  return apiFetch(`/admin/users/${userId}/ban`, { method: 'POST', body: { note } });
}
export async function unbanUser(userId, note) {
  return apiFetch(`/admin/users/${userId}/unban`, { method: 'POST', body: { note } });
}

// F1 — identity-verification action on a member (from the report context).
// POST /admin/users/:id/verify { verified, note? } → { ok, verified }.
// Note optional (backend doesn't require it for verify). 409 on a no-op.
export async function verifyUser(userId, verified, note) {
  const body = { verified };
  if (note) body.note = note;
  return apiFetch(`/admin/users/${userId}/verify`, { method: 'POST', body });
}

// P1-A — reported conversation context. GET /admin/reports/:id/context →
// { conversationId, live, messages:[{ id, senderId, senderName, senderEmail,
//   fromReported, body, deleted, createdAt, attachments:[{id,url,mimeType,status}] }],
//   snapshot }. `live:false` → render the `snapshot` saved-evidence fallback.
export async function getReportContext(id) {
  const d = await apiFetch(`/admin/reports/${encodeURIComponent(id)}/context`);
  return {
    conversationId: d?.conversationId ?? null,
    live: !!d?.live,
    messages: Array.isArray(d?.messages) ? d.messages : [],
    snapshot: d?.snapshot ?? null,
    // Needed #10 — the reporter-pinned message (id + frozen text). `pinned` on a
    // live message marks the same one for highlighting.
    pinnedMessageId: d?.pinnedMessageId ?? null,
    pinnedMessage: d?.pinnedMessage ?? null,
  };
}

// P1-B — one user's repeat-offender history. GET /admin/users/:id/history →
// { userId, email, suspended, accountCreatedAt, reportsAgainst, reportsActioned,
//   distinctBlockers }. (The report cards render from the serialized per-report
// counts; this is here for a dedicated user drill-down.)
export async function getUserHistory(id) {
  return apiFetch(`/admin/users/${encodeURIComponent(id)}/history`);
}

// F1 — pending identity-verification queue (admin).
// GET /admin/verification-requests?status=pending
// → { requests: [{ userId, email, displayName, photoUrl, requestedAt, status }] }
// (newest first). Admins grant/deny each via verifyUser(userId, true|false).
export async function getVerificationRequests(status = 'pending') {
  const d = await apiFetch(`/admin/verification-requests?status=${encodeURIComponent(status)}`);
  return Array.isArray(d?.requests) ? d.requests : [];
}

// F2 — moderation audit log. GET /admin/audit-log
// → { log: [{ id, action, targetId, detail, createdAt, actor }] } (newest first).
export async function getAuditLog() {
  const d = await apiFetch('/admin/audit-log');
  return Array.isArray(d?.log) ? d.log : [];
}

// F3 — feedback (member submit). POST /feedback { message } (≤2000 chars).
export async function submitFeedback(message) {
  return apiFetch('/feedback', { method: 'POST', body: { message } });
}

// F3 — feedback inbox (admin). GET /admin/feedback
// → { feedback: [{ id, userEmail, message, createdAt }] } (newest first).
export async function getAdminFeedback() {
  const d = await apiFetch('/admin/feedback');
  return Array.isArray(d?.feedback) ? d.feedback : [];
}

// Admin maintenance — bulk-delete automated-test accounts (@spectrum-test.dev).
// POST /admin/purge-test-accounts { includeDemo } → { deleted: <count> }.
// includeDemo (default false) ALSO removes @sample.spectrum-dating.app demo
// personas; the default never touches demo or real accounts.
export async function purgeTestAccounts(includeDemo = false) {
  const d = await apiFetch('/admin/purge-test-accounts', { method: 'POST', body: { includeDemo } });
  return d?.deleted ?? 0;
}

// Backend stats use members/total*/suspendedUsers keys; normalise to the flat
// shape AdminScreen reads. `members` excludes test/demo accounts (B-A); the
// oldest-*-At epochs (null when the queue is empty) drive the age subtext + the
// past-SLA amber tone (B-B).
export async function getAdminStats(demo = false) {
  const s = await apiFetch(`/admin/stats${demo ? '?demo=1' : ''}`);
  const members = s.members ?? s.totalUsers ?? s.users ?? 0;
  return {
    members,
    users: members, // back-compat alias
    testAccounts: s.testAccounts ?? 0,
    suspended: s.suspendedUsers ?? s.suspended ?? 0,
    matches: s.totalMatches ?? s.matches ?? 0,
    conversations: s.totalConversations ?? s.conversations ?? 0,
    messages: s.totalMessages ?? s.messages ?? 0,
    reports: s.reports || { open: 0, reviewed: 0, actioned: 0, dismissed: 0 },
    pendingAttachments: s.pendingAttachments ?? 0,
    pendingProfilePhotos: s.pendingProfilePhotos ?? 0,
    pendingVerifications: s.pendingVerifications ?? 0,
    oldestOpenReportAt: s.oldestOpenReportAt ?? null,
    oldestPendingAttachmentAt: s.oldestPendingAttachmentAt ?? null,
    oldestPendingProfilePhotoAt: s.oldestPendingProfilePhotoAt ?? null,
    oldestPendingVerificationAt: s.oldestPendingVerificationAt ?? null,
  };
}
// `messageId` (optional) pins the SPECIFIC offending message the reporter
// flagged (Needed #10). The server validates it belongs to the reported
// conversation AND was sent by the reported user, ignoring it otherwise — so a
// report from the profile/header (no messageId) is unchanged.
export async function reportUser(reportedUserId, reason, details, conversationId, messageId) {
  return apiFetch('/messaging/report', { method: 'POST', body: { reportedUserId, reason, details, conversationId, messageId } });
}

// Reports the current user has filed — for the "Your reports" status view.
export async function getMyReports() {
  const d = await apiFetch('/messaging/my-reports');
  return Array.isArray(d?.reports) ? d.reports : (Array.isArray(d) ? d : []);
}

// Withdraw a report you filed. Only works while the report is still 'open';
// the server 409s if it's already been reviewed. → { ok, status: 'withdrawn' }
export async function withdrawReport(reportId) {
  return apiFetch(`/messaging/reports/${reportId}/withdraw`, { method: 'POST' });
}

// ─── Message requests / intros ──────────────────────────────────────────────
// Opt-in "reach a non-match" flow (audit/MESSAGE_REQUESTS.md). SAFETY-CRITICAL
// on the send path: the backend returns an IDENTICAL 201 { ok: true } for every
// outcome — real send, blocked pair, already-declined, non-existent recipient —
// so the sender can NEVER learn whether the intro was delivered, blocked, or
// declined. The client must therefore show ONE calm confirmation on any 2xx and
// only ever act on the REAL errors the backend surfaces (400 bad intro / 422
// pending-cap / 429 rate-limit). Never branch the success UI on the response.
export async function sendMessageRequest(recipientId, intro) {
  return apiFetch('/messaging/requests', { method: 'POST', body: { recipientId, intro } });
}

// Inbound pending intros for the recipient. → { requests: [...], count }. Each
// request carries a Discover-level projection of the sender (coarse city only;
// never post-match fields). Normalised to a defaulted shape at this boundary.
export async function getMessageRequests() {
  const d = await apiFetch('/messaging/requests');
  const requests = Array.isArray(d?.requests) ? d.requests : [];
  return { requests, count: d?.count ?? requests.length };
}

// The SENDER's outbox — ONLY pending + accepted are ever returned (a declined or
// ignored intro is invisible to the sender; anti-retaliation core). Accepted
// rows carry the conversationId to deep-link into the now-normal thread.
export async function getSentMessageRequests() {
  const d = await apiFetch('/messaging/requests/sent');
  return Array.isArray(d?.requests) ? d.requests : [];
}

// Accept an inbound intro → mints a real match + conversation via the existing
// path and returns { conversationId }. 422 CAP_REACHED when the recipient's
// active-conversation cap is full (stays pending; archive one first).
export async function acceptMessageRequest(id) {
  return apiFetch(`/messaging/requests/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

// Decline an inbound intro (silent to the sender). "Ignore" is a client-only
// no-op — leave the row pending, indistinguishable to the sender from a decline.
export async function declineMessageRequest(id) {
  return apiFetch(`/messaging/requests/${encodeURIComponent(id)}/decline`, { method: 'POST' });
}

// Sender edits their own still-pending intro (the typo escape hatch). Re-runs
// the same 8-10 screening as send, so it can 400 with the safe intro messages.
export async function editMessageRequest(id, intro) {
  return apiFetch(`/messaging/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: { intro } });
}

// ─── Telemetry beacon (public, fire-and-forget) ─────────────────────────────
// Records a single anonymous page view. It NEVER blocks navigation, NEVER
// surfaces an error, and swallows everything — a telemetry beacon must never
// affect the client. The server derives session/geo (cookieless, IP never
// stored); we send only the current app path + the browser referrer. keepalive
// lets the request survive a tab/route teardown. No cookies, no stored id.
// Uses the raw BASE_URL (not apiFetch) so it stays auth-agnostic and can't throw
// through the shared 401 handling. NEVER await this.
export function sendPageview(path) {
  try {
    if (!BASE_URL) return; // no backend configured → nothing to send
    fetch(`${BASE_URL}/telemetry/pageview`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: path || "",
        referrer: typeof document !== "undefined" ? document.referrer : "",
      }),
    }).catch(() => {});
  } catch { /* never surface a beacon error */ }
}

// ─── Public server health probe (admin Site-health panel) ───────────────────
// GET /health is public (no auth) and returns { status, sha, db }. We fetch it
// with the raw BASE_URL — not apiFetch — so it stays auth-agnostic and a failed
// probe can't throw through the shared 401 handling. Any network failure or
// non-200 is normalized to `{ reachable:false }` so the caller renders a calm
// "unreachable" state instead of an error. Never throws.
export async function getServerHealth() {
  if (!BASE_URL) return { reachable: false, status: null, db: null, sha: null };
  try {
    const res = await fetch(`${BASE_URL}/health`, { method: "GET" });
    if (!res.ok) return { reachable: false, status: null, db: null, sha: null };
    const d = await res.json().catch(() => ({}));
    return {
      reachable: true,
      status: d?.status || "ok",
      // 'up' | 'down' | null (older builds omit `db` → null = "not reported").
      db: d?.db || null,
      sha: d?.sha || null,
    };
  } catch {
    return { reachable: false, status: null, db: null, sha: null };
  }
}

// ─── Admin: telemetry dashboard + member management ─────────────────────────
// All requireAuth+requireAdmin. `demo` flips the telemetry queries to the
// seeded demo dataset (is_demo=1); real queries hardcode is_demo=0. Shapes
// mirror server/src/routes/adminTelemetry.js exactly (normalized here so the UI
// reads one flat, defaulted shape — house rule: normalize at the api boundary).
const demoQuery = (demo) => (demo ? "&demo=1" : "");

export async function getTelemetryOverview(window = "7d", demo = false) {
  const d = await apiFetch(`/admin/telemetry/overview?window=${encodeURIComponent(window)}${demoQuery(demo)}`);
  return {
    window: d?.window || window,
    demo: !!d?.demo,
    totalViews: d?.totalViews ?? 0,
    uniqueVisitors: d?.uniqueVisitors ?? 0,
    series: Array.isArray(d?.series) ? d.series : [],
    topPaths: Array.isArray(d?.topPaths) ? d.topPaths : [],
  };
}

export async function getTelemetryGeo(window = "7d", demo = false) {
  const d = await apiFetch(`/admin/telemetry/geo?window=${encodeURIComponent(window)}${demoQuery(demo)}`);
  return Array.isArray(d?.rows) ? d.rows : [];
}

export async function getTelemetryReferrers(window = "7d", demo = false) {
  const d = await apiFetch(`/admin/telemetry/referrers?window=${encodeURIComponent(window)}${demoQuery(demo)}`);
  return Array.isArray(d?.rows) ? d.rows : [];
}

export async function getTelemetryUptime(demo = false) {
  const d = await apiFetch(`/admin/telemetry/uptime?${demo ? "demo=1" : ""}`);
  return {
    layer: d?.layer || "application",
    processStartedAt: d?.processStartedAt ?? null,
    currentUptimeMs: d?.currentUptimeMs ?? 0,
    windows: d?.windows || { "24h": 0, "7d": 0, "30d": 0 },
    incidents: Array.isArray(d?.incidents) ? d.incidents : [],
  };
}

// Privacy-safe activity trends for the Matches / Messages drill-ins — matches
// and messages counted per UTC day, plus all-time totals. COUNTS ONLY: the
// backend never returns identities, match pairs, or message content. window ∈
// '7d'|'30d'. Normalized to one flat, defaulted shape at the api boundary.
export async function getActivityTrends(window = "7d") {
  const d = await apiFetch(`/admin/telemetry/activity?window=${encodeURIComponent(window)}`);
  return {
    window: d?.window || window,
    matchesDaily: Array.isArray(d?.matchesDaily) ? d.matchesDaily : [],
    messagesDaily: Array.isArray(d?.messagesDaily) ? d.messagesDaily : [],
    totalMatches: d?.totalMatches ?? 0,
    totalMessages: d?.totalMessages ?? 0,
  };
}

// Transparency report — aggregate enforcement stats over a period (the internal
// analog of a public "Safe Dating Report"). period ∈ '7d'|'30d'|'90d'|'all'.
// COUNTS ONLY: the backend returns enum labels (action/kind/reason/status/
// signal_kind) + counts + anonymous resolution durations — never ids, names, or
// message content. Normalized to one flat, defaulted shape at the api boundary.
export async function getTransparency(period = "30d") {
  const d = await apiFetch(`/admin/transparency?period=${encodeURIComponent(period)}`);
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    period: d?.period || period,
    scope: d?.scope || "platform",
    generatedAt: d?.generatedAt ?? null,
    enforcement: {
      byAction: arr(d?.enforcement?.byAction),
      byNoticeKind: arr(d?.enforcement?.byNoticeKind),
      totalActions: d?.enforcement?.totalActions ?? 0,
      totalNotices: d?.enforcement?.totalNotices ?? 0,
    },
    reports: {
      filed: d?.reports?.filed ?? 0,
      byReason: arr(d?.reports?.byReason),
      byOutcome: arr(d?.reports?.byOutcome),
      resolvedCount: d?.reports?.resolvedCount ?? 0,
      avgResolutionMs: d?.reports?.avgResolutionMs ?? null,
      medianResolutionMs: d?.reports?.medianResolutionMs ?? null,
    },
    safetySignals: {
      total: d?.safetySignals?.total ?? 0,
      byKind: arr(d?.safetySignals?.byKind),
    },
    // Moderator QA calibration health (counts only — never a per-moderator
    // scoreboard). agreementRate is a 0–1 ratio; 0 when there are no reviews.
    qa: {
      totalReviews: d?.qa?.totalReviews ?? 0,
      agreeCount: d?.qa?.agreeCount ?? 0,
      disagreeCount: d?.qa?.disagreeCount ?? 0,
      agreementRate: d?.qa?.agreementRate ?? 0,
    },
  };
}

// Moderator QA / decision re-review sampling (calibration-only). Pull a small
// random sample of ALREADY-RESOLVED reports the current admin did NOT resolve
// themselves and that haven't been QA-reviewed yet. Each item mirrors the
// report-card shape (reason, moderatorNote, status, resolvedAt, resolvedBy,
// reportedName) — reporter identity is never included. → normalized array.
export async function getQaSample(limit = 5) {
  const d = await apiFetch(`/admin/qa/sample?limit=${encodeURIComponent(limit)}`);
  const arr = Array.isArray(d?.sample) ? d.sample : [];
  return arr.map((r) => ({
    id: r.id,
    reason: r.reason || "",
    moderatorNote: r.moderatorNote || "",
    status: r.status || "",
    resolvedAt: r.resolvedAt ?? null,
    resolvedBy: r.resolvedBy || null,
    reportedName: r.reportedName || "",
  }));
}

// Record one QA calibration verdict for a resolved report. verdict ∈
// 'agree'|'disagree'; note optional. The backend 409s if the report isn't
// resolved, the caller resolved it themselves, or it's already been reviewed.
export async function submitQaReview(reportId, verdict, note) {
  const body = { verdict };
  if (note && note.trim()) body.note = note.trim();
  return apiFetch(`/admin/qa/${encodeURIComponent(reportId)}/review`, { method: "POST", body });
}

// Member email-domain breakdown — real members only (test/demo excluded server
// side). Not demo-toggled: this is member data, not visitor telemetry.
export async function getMemberDomains() {
  const d = await apiFetch("/admin/telemetry/member-domains");
  return Array.isArray(d?.rows) ? d.rows : [];
}

// Admin — load or clear the demo telemetry dataset from inside the admin panel
// (the CLI seed script can't reach the prod DB on Railway's volume).
// POST /admin/telemetry/demo { action: 'load' | 'clear' } → { ok, action, counts }.
// Everything it loads is is_demo=1 telemetry + `telemetry-demo-` members ONLY,
// so it can never pollute real counts. Clear removes exactly those.
export async function setDemoData(action) {
  return apiFetch("/admin/telemetry/demo", { method: "POST", body: { action } });
}

// Real-member Population / Demographics breakdowns (test/demo excluded server
// side). Each breakdown is [{ label, count|null, masked, value? }] — a masked
// bucket (count 1–4) has count:null + masked:true and is rendered "<5"; the
// exact small count never leaves the server (k-anonymity, k=5). Multi-select
// breakdowns can sum to more than totalMembers (one count per chosen token).
export async function getPopulation(demo = false) {
  const d = await apiFetch(`/admin/population${demo ? "?demo=1" : ""}`);
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    demo: !!d?.demo,
    totalMembers: d?.totalMembers ?? 0,
    gender: arr(d?.gender),
    orientation: arr(d?.orientation),
    seeking: arr(d?.seeking),
    relationshipStructure: arr(d?.relationshipStructure),
    relationshipGoal: arr(d?.relationshipGoal),
    ageBands: arr(d?.ageBands),
    location: arr(d?.location),
    interests: arr(d?.interests),
  };
}

// Paginated member listing. status ∈ ''|'active'|'suspended'|'verified';
// sort ∈ 'joined'|'reports'. Optional demographic filters (from the Population
// report drill-down): gender, orientation, seeking, relationshipStructure,
// relationshipGoal (single/token match), city (exact), ageMin/ageMax.
// includeDemo/includeTest are independent opt-ins (both default OFF, keeping the
// real-member view clean): includeDemo adds the @sample demo members, includeTest
// adds the @spectrum-test.dev QA accounts.
// Returns { total, page, pageSize, members }.
export async function getMembers({
  query = "", status = "", page = 1, pageSize = 25, sort = "joined",
  gender = "", orientation = "", seeking = "", relationshipStructure = "",
  relationshipGoal = "", city = "", ageMin = null, ageMax = null,
  includeDemo = false, includeTest = false,
} = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status && status !== "all") params.set("status", status);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("sort", sort);
  if (includeDemo) params.set("includeDemo", "1");
  if (includeTest) params.set("includeTest", "1");
  if (gender) params.set("gender", gender);
  if (orientation) params.set("orientation", orientation);
  if (seeking) params.set("seeking", seeking);
  if (relationshipStructure) params.set("relationshipStructure", relationshipStructure);
  if (relationshipGoal) params.set("relationshipGoal", relationshipGoal);
  if (city) params.set("city", city);
  if (Number.isFinite(ageMin) && ageMin > 0) params.set("ageMin", String(ageMin));
  if (Number.isFinite(ageMax) && ageMax > 0) params.set("ageMax", String(ageMax));
  const d = await apiFetch(`/admin/members?${params.toString()}`);
  return {
    total: d?.total ?? 0,
    page: d?.page ?? page,
    pageSize: d?.pageSize ?? pageSize,
    members: Array.isArray(d?.members) ? d.members : [],
  };
}

// Member detail for the drawer — userContext + report history + counts +
// verified/suspended/accountAge/lastActiveAt.
export async function getMemberDetail(id) {
  return apiFetch(`/admin/members/${encodeURIComponent(id)}`);
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export async function toggleReaction(messageId, emoji) {
  return apiFetch(`/reactions/messages/${messageId}/reactions`, {
    method: "POST",
    body: { emoji },
  });
}

// ─── Starters ─────────────────────────────────────────────────────────────────

export async function getStarters(conversationId) {
  return apiFetch(`/starters/conversations/${conversationId}`);
}

// ─── Photo upload ─────────────────────────────────────────────────────────────

export async function getProfileUploadUrl(mimeType) {
  return apiFetch("/photos/profile-upload-url", { method: "POST", body: { mimeType } });
}

export async function confirmProfilePhoto(key) {
  return apiFetch("/photos/profile-confirm", { method: "POST", body: { key } });
}

export async function addProfilePhoto(key) {
  const d = await apiFetch('/photos/profile-add', { method: 'POST', body: { key } });
  return Array.isArray(d?.photos) ? d.photos : [];
}

export async function setPrimaryPhoto(id) {
  const d = await apiFetch(`/photos/profile-photos/${id}/primary`, { method: 'PUT' });
  return Array.isArray(d?.photos) ? d.photos : [];
}

export async function deleteProfilePhoto(id) {
  const d = await apiFetch(`/photos/profile-photos/${id}`, { method: 'DELETE' });
  return Array.isArray(d?.photos) ? d.photos : [];
}

export async function updatePhotoDescription(id, description) {
  return apiFetch(`/photos/profile-photos/${id}/description`, { method: 'PUT', body: { description } });
}

// Message attachment upload flow (backlog #9 / Error Log E2).
// upload-intent → { attachmentId, storageKey, uploadUrl, publicUrl } (status pending).
export async function uploadAttachmentIntent({ mimeType, fileSizeBytes }) {
  return apiFetch('/photos/upload-intent', { method: 'POST', body: { mimeType, fileSizeBytes } });
}

// confirm/:attachmentId → { attachmentId, status: 'pending_review' }.
export async function confirmAttachment(attachmentId) {
  return apiFetch(`/photos/confirm/${attachmentId}`, { method: 'POST' });
}

// Back-compat alias for the existing positional call signature.
export async function uploadIntent(mimeType, fileSizeBytes) {
  return uploadAttachmentIntent({ mimeType, fileSizeBytes });
}

// ─── Admin: photo attachment review ─────────────────────────────────────────────

// GET /admin/attachments?status=pending_review
// → { attachments: [{ id, uploaderId, uploaderEmail, publicUrl, mimeType, createdAt }] }
export async function getPendingAttachments(status = 'pending_review') {
  const d = await apiFetch(`/admin/attachments?status=${encodeURIComponent(status)}`);
  return Array.isArray(d?.attachments) ? d.attachments : [];
}

// POST /admin/attachments/:id/review { decision: 'approved'|'rejected', note? } → { ok, status }
// A rejection requires a moderator note (backend 400s without one); approve does not.
export async function reviewAttachment(id, decision, note) {
  const body = { decision };
  if (note) body.note = note;
  return apiFetch(`/admin/attachments/${id}/review`, { method: 'POST', body });
}

// ─── Admin: profile-photo review (SAFETY-2) ─────────────────────────────────────

// GET /admin/profile-photos/pending
// → { photos: [{ id, userId, ownerEmail, ownerDisplayName, url, description, createdAt }] }
export async function getPendingProfilePhotos() {
  const d = await apiFetch('/admin/profile-photos/pending');
  return Array.isArray(d?.photos) ? d.photos : [];
}

// POST /admin/profile-photos/:id/review { decision: 'approve'|'reject', note? } → { ok, status }
// A rejection requires a moderator note (backend 400s without one); approve does not.
export async function reviewProfilePhoto(id, decision, note) {
  const body = { decision };
  if (note) body.note = note;
  return apiFetch(`/admin/profile-photos/${id}/review`, { method: 'POST', body });
}

// ─── Account ───────────────────────────────────────────────────────────────────

export async function deleteAccount() {
  const res = await apiFetch('/account/me', { method: 'DELETE' });
  clearAuth();
  return res;
}

// ─── Billing / entitlements ─────────────────────────────────────────────────────
// Mirrors the backend billing routes (audit/BILLING_ARCHITECTURE.md). NO real
// payments in this phase: the provider is the stub, so startCheckout resolves to
// { configured: false } and the UI shows a calm "coming soon" — never a fake
// charge. A member can never self-grant Companion; the admin* helpers below are
// admin-gated + rate-limited server side (QA/non-admin callers get 403).

// GET /billing/tiers → the static catalog. Normalised to an array (free first).
export async function getBillingTiers() {
  const d = await apiFetch("/billing/tiers");
  return Array.isArray(d?.tiers) ? d.tiers : [];
}

// GET /billing/me → the caller's { tier, status, source }. Defaulted at this
// boundary so callers never branch on a missing field ("no row = free").
export async function getMyEntitlement() {
  const d = await apiFetch("/billing/me");
  return {
    tier: d?.tier || "free",
    status: d?.status || "active",
    source: d?.source || "none",
  };
}

// POST /billing/checkout → with the stub returns { configured: false } (grants
// nothing). Callers show the calm "coming soon" note on { configured: false }.
export async function startCheckout(tier = "companion") {
  return apiFetch("/billing/checkout", { method: "POST", body: { tier } });
}

// POST /billing/cancel → for an admin_demo grant reverts the caller to free.
// Returns { ...providerResult, entitlement }.
export async function cancelSubscription() {
  return apiFetch("/billing/cancel", { method: "POST" });
}

// Admin (requireAdmin, rate-limited) — demo tier controls. Never real billing.
export async function adminSetEntitlement(userId, tier) {
  return apiFetch("/admin/entitlements", { method: "POST", body: { userId, tier } });
}

export async function adminSetSelfEntitlement(tier) {
  return apiFetch("/admin/entitlements/self", { method: "POST", body: { tier } });
}

export async function adminClearDemoEntitlements() {
  return apiFetch("/admin/entitlements/demo", { method: "DELETE" });
}

// ─── Push notifications ────────────────────────────────────────────────────────

export async function getPushVapidKey() {
  return apiFetch('/push/vapid-public-key');
}

export async function savePushSubscription(subscription) {
  const sub = subscription.toJSON();
  return apiFetch('/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    },
  });
}

export async function removePushSubscription(endpoint) {
  return apiFetch('/push/subscribe', {
    method: 'DELETE',
    body: { endpoint },
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function getExportUrl() {
  const token = getToken();
  const base = `${BASE_URL}/export/conversations`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
