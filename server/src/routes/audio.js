// Profile AUDIO prompt answers — the member-side safety spine.
//
// This is the profile_photos model with an <audio> tag and a required transcript
// (see audit/AUDIO_PROMPTS_MODERATION.md). Non-negotiables enforced here:
//   • Human-review-before-serve: a new clip is 'pending_review' and visible to
//     NOBODY but its owner until a moderator approves it (mirrors SAFETY-2). The
//     approved-only listPublicAudio default is what guarantees this.
//   • Member-typed transcript is REQUIRED at confirm time — empty/whitespace →
//     400, no row created — and is FREE to every viewer (the a11y floor).
//   • RECORD/POST is Companion (requirePaid); PLAYBACK + transcript + matching +
//     being seen stay FREE. DELETE is UNGATED — a downgraded member must always
//     be able to remove their own content.
//   • The transcript runs through classifySafetySignal() at submit, logging an
//     observe-only offender signal (never blocks — calm-by-design).
//   • Pending audio is served only to owner/admin via a short-lived presigned
//     GET (voice = more PII than a photo), never a stable public URL.
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, isAdminUser } from '../middleware/admin.js';
import { requirePaid } from '../billing/entitlements.js';
import { mutationLimiter } from '../middleware/rateLimits.js';
import { newId } from '../utils/ids.js';
import { classifySafetySignal } from '../utils/safetySignals.js';
import {
  r2Configured,
  getPresignedUploadUrl,
  getPresignedGetUrl,
  getPublicUrl,
  deleteObject,
} from '../storage/r2.js';

const router = Router();

// audio/* MIME allowlist (mirrors ALLOWED_MIME in photos.js). ext is derived
// from the key at confirm time via EXT_TO_MIME so we never trust a free-text
// mime field on the confirm.
const ALLOWED_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']);
const MIME_TO_EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };
const EXT_TO_MIME = { webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg' };

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — a short spoken answer, capped.
const MAX_DURATION_MS = 60_000;        // 60 s — short answer = calm; caps review time.
const MAX_TRANSCRIPT = 2000;           // chars
const MAX_AUDIO = 3;                    // audio answers per profile (MVP ceiling).

// Per-user AUDIO upload rate limit (the security flag: the queue can't be
// flooded). Its OWN bucket, separate from mutationLimiter — a flood here must
// not rate-starve swipes/photos. Keyed per-user; a generous-but-hard ceiling.
const audioUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.ctx?.userId ? `u:${req.ctx.userId}` : ipKeyGenerator(req.ip)),
  message: { error: 'Too many audio uploads. Please wait a few minutes and try again.' },
});

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

// The APPROVED-ONLY list served to a VIEWER (matched profile / Discover). Built
// on an approved-only default exactly like listPublicPhotos — never hand-roll a
// query that could leak pending/rejected audio. requireAuth only (FREE) on the
// read path; the transcript is never gated (a11y floor). Returns the minimal
// viewer shape { promptKey, url, transcript, durationMs }.
export function listPublicAudio(db, userId) {
  const rows = db.prepare(
    `SELECT prompt_key, url, transcript, duration_ms
     FROM profile_audio
     WHERE user_id = ? AND review_status = 'approved'
     ORDER BY position ASC, created_at ASC`
  ).all(userId);
  return rows.map((r) => ({
    promptKey: r.prompt_key,
    url: r.url,
    transcript: r.transcript,
    durationMs: r.duration_ms ?? null,
  }));
}

// The OWNER's own clips (incl. pending/rejected) for their editor. No public URL
// is emitted for a pending clip — the owner plays it back through the presigned
// /audio/:id/playback-url endpoint (owner/admin only) so an un-approved clip
// never sits behind a stable public link.
export function listOwnAudio(db, userId) {
  const rows = db.prepare(
    `SELECT id, prompt_key, url, transcript, duration_ms, review_status, created_at
     FROM profile_audio
     WHERE user_id = ?
     ORDER BY position ASC, created_at ASC`
  ).all(userId);
  return rows.map((r) => ({
    id: r.id,
    promptKey: r.prompt_key,
    // Only an APPROVED clip exposes its stable URL to its owner; a pending clip
    // is playable only via the presigned playback-url endpoint.
    url: r.review_status === 'approved' ? r.url : '',
    transcript: r.transcript,
    durationMs: r.duration_ms ?? null,
    reviewStatus: r.review_status,
    pending: r.review_status === 'pending_review',
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// POST /audio/profile-upload-url  (Companion)
// Presigned PUT for an audio upload. body { mimeType, fileSizeBytes, durationMs }
// ---------------------------------------------------------------------------
router.post('/profile-upload-url', requireAuth, requirePaid, mutationLimiter, audioUploadLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const { mimeType, fileSizeBytes, durationMs } = req.body ?? {};

  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` });
  }
  // Server-side size cap BEFORE presigning (mirrors /upload-intent). ContentType
  // is baked into the presign in r2.js; ContentLength is deliberately not signed
  // (same rationale as photos) — this integer check + a bucket-level object-size
  // ceiling are the real cap.
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
    return res.status(400).json({ error: `fileSizeBytes must be an integer between 1 and ${MAX_FILE_SIZE}` });
  }
  // Duration is client-declared + advisory (the size cap is the real ceiling),
  // but reject an obviously-too-long declared clip up front.
  if (durationMs !== undefined && durationMs !== null) {
    if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
      return res.status(400).json({ error: `durationMs must be an integer between 1 and ${MAX_DURATION_MS}` });
    }
  }

  // Hard count cap up front so we never mint an upload URL a confirm would 409.
  const count = db.prepare('SELECT COUNT(*) AS n FROM profile_audio WHERE user_id = ?').get(userId).n;
  if (count >= MAX_AUDIO) {
    return res.status(409).json({ error: `You can have at most ${MAX_AUDIO} audio answers.` });
  }

  if (!r2Configured()) {
    return res.status(503).json({ error: 'Audio storage not configured.' });
  }

  const ext = MIME_TO_EXT[mimeType];
  const key = `profile-audio/${userId}/${newId()}.${ext}`;
  try {
    const uploadUrl = await getPresignedUploadUrl(key, mimeType, 300);
    res.json({ uploadUrl, key });
  } catch (e) {
    console.error('R2 presign error (audio):', e);
    res.status(500).json({ error: 'Could not generate upload URL.' });
  }
});

// ---------------------------------------------------------------------------
// POST /audio/profile-confirm  (Companion)
// body { key, promptKey, transcript, durationMs }
// Creates the profile_audio row 'pending_review'. REQUIRES a non-empty
// transcript (empty → 400, NO row created). Runs the transcript through the
// off-platform/scam detector (observe-only offender signal).
// ---------------------------------------------------------------------------
router.post('/profile-confirm', requireAuth, requirePaid, mutationLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const { key, promptKey, transcript, durationMs } = req.body ?? {};

  // Key-ownership check (mirror photos.js:76): a caller can't claim someone
  // else's object.
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'key is required.' });
  }
  if (!key.startsWith(`profile-audio/${userId}/`)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const ext = (key.split('.').pop() || '').toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    return res.status(400).json({ error: 'Unsupported audio type.' });
  }

  if (!promptKey || typeof promptKey !== 'string' || !promptKey.trim()) {
    return res.status(400).json({ error: 'promptKey is required.' });
  }

  // The KEYSTONE: a member-typed transcript is required. A clip literally cannot
  // enter the review queue without one — empty/whitespace → 400, no row.
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'A transcript is required for every audio answer.' });
  }
  const cleanTranscript = transcript.trim().slice(0, MAX_TRANSCRIPT);

  // One active audio answer per (user, prompt); overall count cap.
  const count = db.prepare('SELECT COUNT(*) AS n FROM profile_audio WHERE user_id = ?').get(userId).n;
  if (count >= MAX_AUDIO) {
    return res.status(409).json({ error: `You can have at most ${MAX_AUDIO} audio answers.` });
  }
  const existing = db.prepare(
    'SELECT id FROM profile_audio WHERE user_id = ? AND prompt_key = ?'
  ).get(userId, promptKey.trim());
  if (existing) {
    return res.status(409).json({ error: 'You already have an audio answer for this prompt. Delete it first to re-record.' });
  }

  let clampedDuration = null;
  if (Number.isInteger(durationMs) && durationMs > 0) {
    clampedDuration = Math.min(durationMs, MAX_DURATION_MS);
  }

  const id = newId();
  const url = r2Configured() ? getPublicUrl(key) : key;
  const now = Date.now();
  const nextPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM profile_audio WHERE user_id = ?'
  ).get(userId).pos;

  // SAFETY: new clip enters the review queue as 'pending_review'. It is NOT
  // mirrored to any publicly-served field — it becomes visible to others only
  // when a moderator approves it (listPublicAudio approved-only default).
  db.prepare(
    `INSERT INTO profile_audio
       (id, user_id, prompt_key, storage_key, url, transcript, duration_ms, mime_type, review_status, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)`
  ).run(id, userId, promptKey.trim(), key, url, cleanTranscript, clampedDuration, mimeType, nextPos, now);

  // Submit-time safety screening on the TRANSCRIPT (§3.3). Observe-only: never
  // blocks the clip (it still goes to the human queue like every other clip);
  // it appends one repeat-offender signal attributed to the uploader so a member
  // routing people off-platform via voice accrues the same grooming signal the
  // console already surfaces. The transcript can lie — this is a triage aid on
  // top of the mandatory human listen, never the gate.
  const signal = classifySafetySignal(cleanTranscript);
  if (signal) {
    db.prepare(
      `INSERT INTO chat_safety_signals (id, user_id, conversation_id, message_id, signal_kind, created_at)
       VALUES (?, ?, NULL, ?, ?, ?)`
    ).run(newId(), userId, id, signal, now);
  }

  res.status(201).json({ id, status: 'pending_review', audio: listOwnAudio(db, userId) });
});

// ---------------------------------------------------------------------------
// GET /audio/mine — the owner's own clips (incl. pending). requireAuth only so a
// DOWNGRADED (free) member can still see/manage what they recorded.
// ---------------------------------------------------------------------------
router.get('/mine', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  res.json({ audio: listOwnAudio(db, userId) });
});

// ---------------------------------------------------------------------------
// GET /audio/:id/playback-url — short-lived presigned GET for OWNER or ADMIN.
// This is how a pending (un-approved) clip is played back without ever exposing
// a stable public URL (voice = more PII than a photo). A non-owner/non-admin
// gets a uniform 404 so the endpoint never leaks a clip's existence.
// ---------------------------------------------------------------------------
router.get('/:id/playback-url', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const notAvailable = () => res.status(404).json({ error: 'Audio not available.' });

  const audio = db.prepare(
    'SELECT id, user_id, storage_key FROM profile_audio WHERE id = ?'
  ).get(req.params.id);
  if (!audio) return notAvailable();

  const userRow = db.prepare('SELECT email, is_admin FROM users WHERE id = ?').get(userId);
  const isAdmin = isAdminUser(userRow);
  if (audio.user_id !== userId && !isAdmin) return notAvailable();

  if (!r2Configured()) {
    return res.status(503).json({ error: 'Audio storage not configured.' });
  }
  try {
    const url = await getPresignedGetUrl(audio.storage_key, 600);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ url });
  } catch (e) {
    console.error('R2 presign error (audio playback):', e);
    res.status(500).json({ error: 'Could not generate playback URL.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /audio/:id — owner-only, UNGATED (a downgraded member can always remove
// their own content). Hard-deletes the row + best-effort R2 object.
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const audio = db.prepare(
    'SELECT id, storage_key FROM profile_audio WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);
  if (!audio) return res.status(404).json({ error: 'Audio not found.' });

  db.prepare('DELETE FROM profile_audio WHERE id = ?').run(audio.id);

  if (audio.storage_key) {
    deleteObject(audio.storage_key).catch(() => {});
  }

  res.json({ ok: true, audio: listOwnAudio(db, userId) });
});

// ---------------------------------------------------------------------------
// Admin review — mounted under /admin (requireAdmin + adminApiLimiter), exported
// as a sub-router so index.js can mount it at /admin like adminTelemetry.js.
// ---------------------------------------------------------------------------
export const adminAudioRouter = Router();

// GET /admin/profile-audio/pending — audio review queue with owner context +
// transcript + prompt + duration + url, newest first (mirrors profile-photos).
adminAudioRouter.get('/profile-audio/pending', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const rows = db.prepare(`
    SELECT pa.id, pa.user_id, pa.url, pa.transcript, pa.duration_ms, pa.prompt_key, pa.created_at,
           u.email AS owner_email, p.display_name AS owner_display_name
    FROM profile_audio pa
    LEFT JOIN users u ON u.id = pa.user_id
    LEFT JOIN profiles p ON p.user_id = pa.user_id
    WHERE pa.review_status = 'pending_review'
    ORDER BY pa.created_at DESC
  `).all();

  const audio = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    ownerEmail: r.owner_email || null,
    ownerDisplayName: r.owner_display_name || '',
    url: r.url,
    // The reviewer reads the transcript to triage, but it is MEMBER-PROVIDED and
    // untrusted — the moderator must LISTEN to confirm it matches. The frontend
    // surfaces that caption; a playable presigned URL comes from
    // GET /audio/:id/playback-url (admin-allowed).
    transcript: r.transcript,
    durationMs: r.duration_ms ?? null,
    promptKey: r.prompt_key,
    createdAt: r.created_at,
  }));
  res.json({ audio });
});

// POST /admin/profile-audio/:id/review — body { decision:'approve'|'reject', note }
// A reject REQUIRES a note. Terminal guard: only act on 'pending_review' (else
// 409). On approve → approved + reviewer bookkeeping. On reject → rejected
// (never served) + best-effort deleteObject. logMod the decision.
adminAudioRouter.post('/profile-audio/:id/review', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const { decision, note: rawNote } = req.body ?? {};

  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'." });
  }
  let note = rawNote ?? req.body?.reason ?? '';
  if (typeof note !== 'string') {
    return res.status(400).json({ error: 'note must be a string.' });
  }
  note = note.trim();
  // B-E: a rejection (a destructive moderation action) must be justified.
  if (decision === 'reject' && !note) {
    return res.status(400).json({ error: 'A note/reason is required to reject an audio answer.' });
  }

  const audio = db.prepare(
    'SELECT id, user_id, review_status, storage_key FROM profile_audio WHERE id = ?'
  ).get(req.params.id);
  if (!audio) return res.status(404).json({ error: 'Audio not found.' });
  if (audio.review_status !== 'pending_review') {
    return res.status(409).json({ error: `Cannot review: status is '${audio.review_status}'.` });
  }

  const now = Date.now();
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
  db.prepare(
    'UPDATE profile_audio SET review_status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
  ).run(nextStatus, now, userId, audio.id);

  // Append-only moderation audit log (mirror the photo review path). Kept inline
  // to avoid importing admin.js internals.
  db.prepare(
    'INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId(), userId, decision === 'approve' ? 'approve_profile_audio' : 'reject_profile_audio', audio.id, note, now);

  if (decision === 'reject' && audio.storage_key) {
    deleteObject(audio.storage_key).catch(() => {});
  }

  res.json({ ok: true, status: nextStatus });
});

export default router;
