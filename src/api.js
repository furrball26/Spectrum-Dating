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

// ─── Messaging ────────────────────────────────────────────────────────────────

function normaliseConversationList(arr) {
  return arr.map(({ hasUnread, ...c }) => ({
    ...c,
    // The list UI keys/selects/archives on `conversationId`, but the server
    // returns the conversation under `id` — alias it so row clicks resolve.
    conversationId: c.conversationId ?? c.id,
    lastMessageLabel: c.lastMessageLabel ?? c.lastMessageGroup ?? null,
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
  }));
}

export async function resolveReport(id, status, note) { return apiFetch(`/admin/reports/${id}/resolve`, { method: 'POST', body: { status, note } }); }
export async function suspendUser(userId, suspended) { return apiFetch(`/admin/users/${userId}/suspend`, { method: 'POST', body: { suspended } }); }

// Backend stats use total*/suspendedUsers keys; AdminScreen reads users/suspended/etc.
export async function getAdminStats() {
  const s = await apiFetch('/admin/stats');
  return {
    users: s.totalUsers ?? s.users ?? 0,
    suspended: s.suspendedUsers ?? s.suspended ?? 0,
    matches: s.totalMatches ?? s.matches ?? 0,
    conversations: s.totalConversations ?? s.conversations ?? 0,
    messages: s.totalMessages ?? s.messages ?? 0,
    reports: s.reports || { open: 0, reviewed: 0, actioned: 0, dismissed: 0 },
  };
}
export async function reportUser(reportedUserId, reason, details, conversationId) {
  return apiFetch('/messaging/report', { method: 'POST', body: { reportedUserId, reason, details, conversationId } });
}

// Reports the current user has filed — for the "Your reports" status view.
export async function getMyReports() {
  const d = await apiFetch('/messaging/my-reports');
  return Array.isArray(d?.reports) ? d.reports : (Array.isArray(d) ? d : []);
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

// POST /admin/attachments/:id/review { decision: 'approved'|'rejected' } → { ok, status }
export async function reviewAttachment(id, decision) {
  return apiFetch(`/admin/attachments/${id}/review`, { method: 'POST', body: { decision } });
}

// ─── Account ───────────────────────────────────────────────────────────────────

export async function deleteAccount() {
  const res = await apiFetch('/account/me', { method: 'DELETE' });
  clearAuth();
  return res;
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
