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

// ─── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile() {
  return apiFetch("/profile/me");
}

export async function updateProfile(fields) {
  return apiFetch("/profile/me", { method: "PUT", body: fields });
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

export async function getConversations() {
  const data = await apiFetch("/messaging/conversations");
  // Server returns { conversations: [...], activeCap, activeCount, capReached }
  // Normalise to always return the array so callers don't need to know the shape
  return Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : []);
}

export async function getConversation(id) {
  return apiFetch(`/messaging/conversations/${id}`);
}

export async function createConversation(matchId) {
  return apiFetch("/messaging/conversations", {
    method: "POST",
    body: { matchId },
  });
}

export async function sendMessage(conversationId, body) {
  return apiFetch(`/messaging/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { body },
  });
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

export async function blockUser(blockedUserId, reason, details) {
  return apiFetch("/messaging/block", {
    method: "POST",
    body: { blockedUserId, reason, details },
  });
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

// Message attachment upload flow (backlog #9)
export async function uploadIntent(mimeType, fileSizeBytes) {
  return apiFetch('/photos/upload-intent', { method: 'POST', body: { mimeType, fileSizeBytes } });
}

export async function confirmAttachment(attachmentId) {
  return apiFetch(`/photos/confirm/${attachmentId}`, { method: 'POST' });
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
