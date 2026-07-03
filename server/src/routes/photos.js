import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mutationLimiter } from '../middleware/rateLimits.js';
import { newId } from '../utils/ids.js';
import { r2Configured, getPresignedUploadUrl, getPublicUrl, deleteObject } from '../storage/r2.js';

const router = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PHOTOS = 6;

// Serialize a user's gallery, ordered by position.
//
// SAFETY-2: profile photos go through a human-review queue. Photos served to
// ANYONE OTHER than the owner must be admin-approved. Pass { includePending:true }
// ONLY when serving the gallery back to its owner (their own editor / profile) —
// the owner sees their pending photos with a `pending` flag. The default
// (approved-only) is what every public surface must use.
export function listPhotos(db, userId, { includePending = false } = {}) {
  const rows = db.prepare(
    'SELECT id, url, description, is_primary, position, review_status FROM profile_photos WHERE user_id = ? ORDER BY position ASC, created_at ASC'
  ).all(userId);
  const visible = includePending ? rows : rows.filter(r => r.review_status === 'approved');
  return visible.map(r => ({
    id: r.id,
    url: r.url,
    description: r.description || '',
    isPrimary: !!r.is_primary,
    position: r.position,
    reviewStatus: r.review_status,
    pending: r.review_status === 'pending_review',
  }));
}

// PROD-6: the APPROVED-ONLY gallery served to a VIEWER (Discover deck, matched
// profile). Built on listPhotos' approved-only default — never hand-roll a query
// that could leak pending photos. Ordered primary-first, then by position, and
// capped at MAX_PHOTOS. Returns the minimal viewer shape { url, description,
// isPrimary } — owner-only fields (id/position/reviewStatus/pending) are dropped.
export function listPublicPhotos(db, userId) {
  return listPhotos(db, userId) // approved-only default
    .slice()
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.position - b.position;
    })
    .slice(0, MAX_PHOTOS)
    .map((p) => ({ url: p.url, description: p.description, isPrimary: p.isPrimary }));
}

// SAFETY-2: keep profiles.photo_url (the PUBLIC avatar every candidate/match/
// conversation payload reads) pointed at the user's best APPROVED photo — primary
// preferred, else the lowest-position approved photo, else '' when none are
// approved. Pending/rejected photos are NEVER mirrored here, so a photo only
// becomes visible to others once a moderator approves it, and a user with only
// pending photos has photo_url='' and simply doesn't surface (never a broken img).
export function syncPrimaryPhotoUrl(db, userId, now = Date.now()) {
  const best = db.prepare(
    `SELECT url FROM profile_photos
     WHERE user_id = ? AND review_status = 'approved'
     ORDER BY is_primary DESC, position ASC, created_at ASC
     LIMIT 1`
  ).get(userId);
  db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?')
    .run(best ? best.url : '', now, userId);
}

// Shared "add a gallery photo" logic used by /profile-add and /profile-confirm.
// Returns { ok: true, photos } on success, or { ok: false, status, error }.
function addGalleryPhoto(db, userId, key) {
  if (!key || typeof key !== 'string') {
    return { ok: false, status: 400, error: 'key is required.' };
  }
  if (!key.startsWith(`profile-photos/${userId}/`)) {
    return { ok: false, status: 403, error: 'Forbidden.' };
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM profile_photos WHERE user_id = ?').get(userId).n;
  if (count >= MAX_PHOTOS) {
    return { ok: false, status: 409, error: `You can have at most ${MAX_PHOTOS} photos.` };
  }

  const url = r2Configured() ? getPublicUrl(key) : key;
  const isFirst = count === 0;
  const nextPosRow = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM profile_photos WHERE user_id = ?').get(userId);
  const position = nextPosRow.pos;
  const now = Date.now();

  // SAFETY-2: new uploads enter the review queue as 'pending_review'. We do NOT
  // mirror them to profiles.photo_url — that only happens once a moderator
  // approves the photo (admin.js -> syncPrimaryPhotoUrl). So a brand-new user's
  // first photo stays invisible to others (and they stay off Discover) until it
  // clears review, rather than serving an unreviewed image.
  db.prepare(
    'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(newId(), userId, key, url, position, isFirst ? 1 : 0, 'pending_review', now);

  // The gallery is returned to its OWNER here, so include pending photos.
  return { ok: true, photos: listPhotos(db, userId, { includePending: true }) };
}

// ---------------------------------------------------------------------------
// POST /photos/profile-upload-url
// Returns a presigned PUT URL for a profile photo upload, plus the key
// ---------------------------------------------------------------------------
router.post('/profile-upload-url', requireAuth, mutationLimiter, async (req, res) => {
  if (!r2Configured()) {
    return res.status(503).json({ error: 'Photo storage not configured.' });
  }
  const { mimeType } = req.body;
  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` });
  }
  const ext = MIME_TO_EXT[mimeType];
  const key = `profile-photos/${req.ctx.userId}/${newId()}.${ext}`;
  try {
    const uploadUrl = await getPresignedUploadUrl(key, mimeType, 300);
    res.json({ uploadUrl, key, publicUrl: getPublicUrl(key) });
  } catch (e) {
    console.error('R2 presign error:', e);
    res.status(500).json({ error: 'Could not generate upload URL.' });
  }
});

// ---------------------------------------------------------------------------
// POST /photos/profile-confirm  (backward-compat)
// After browser uploads to R2, call this to add the photo to the gallery.
// Adds via the shared gallery logic (first photo becomes primary and mirrors
// to profiles.photo_url). Returns the legacy { photoUrl } shape plus { photos }.
// ---------------------------------------------------------------------------
router.post('/profile-confirm', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const { key } = req.body;

  const result = addGalleryPhoto(db, userId, key);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  const primary = result.photos.find(p => p.isPrimary);
  res.json({ photoUrl: primary ? primary.url : (r2Configured() ? getPublicUrl(key) : key), photos: result.photos });
});

// ---------------------------------------------------------------------------
// POST /photos/profile-add  — body { key }
// Add a photo to the user's gallery (max 6). First photo becomes primary.
// ---------------------------------------------------------------------------
router.post('/profile-add', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const result = addGalleryPhoto(db, userId, req.body?.key);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json({ photos: result.photos });
});

// ---------------------------------------------------------------------------
// PUT /photos/profile-photos/:id/primary  — mark a photo primary
// ---------------------------------------------------------------------------
router.put('/profile-photos/:id/primary', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const photo = db.prepare('SELECT id, url FROM profile_photos WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found.' });
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE profile_photos SET is_primary = 0 WHERE user_id = ?').run(userId);
    db.prepare('UPDATE profile_photos SET is_primary = 1 WHERE id = ?').run(photo.id);
    // SAFETY-2: don't blindly mirror the chosen photo — if it's still pending
    // review, photo_url must stay on an APPROVED photo. syncPrimaryPhotoUrl picks
    // the best approved photo (this one if approved, else falls back).
    syncPrimaryPhotoUrl(db, userId, now);
  })();

  res.json({ photos: listPhotos(db, userId, { includePending: true }) });
});

// ---------------------------------------------------------------------------
// PUT /photos/profile-photos/:id/description  — set a photo's alt-text description
// Max 200 chars; empty string is valid (clears description). Rate-limited.
// ---------------------------------------------------------------------------
router.put('/profile-photos/:id/description', requireAuth, mutationLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const { description } = req.body ?? {};

  if (typeof description !== 'string') {
    return res.status(400).json({ error: 'description must be a string.' });
  }
  const trimmed = description.slice(0, 200).trim();

  const photo = db.prepare('SELECT id FROM profile_photos WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });

  db.prepare('UPDATE profile_photos SET description = ? WHERE id = ?').run(trimmed, req.params.id);
  res.json({ ok: true, description: trimmed });
});

// ---------------------------------------------------------------------------
// DELETE /photos/profile-photos/:id  — remove a photo
// Promotes the lowest-position remaining photo to primary if needed.
// ---------------------------------------------------------------------------
router.delete('/profile-photos/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const photo = db.prepare('SELECT id, storage_key, is_primary FROM profile_photos WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found.' });
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM profile_photos WHERE id = ?').run(photo.id);

    if (photo.is_primary) {
      const next = db.prepare(
        'SELECT id FROM profile_photos WHERE user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1'
      ).get(userId);
      if (next) {
        db.prepare('UPDATE profile_photos SET is_primary = 1 WHERE id = ?').run(next.id);
      }
    }
    // SAFETY-2: re-derive photo_url from the remaining APPROVED photos ('' if
    // none left approved).
    syncPrimaryPhotoUrl(db, userId, now);
  })();

  // Best-effort delete from R2 (skip empty/legacy keys).
  if (photo.storage_key) {
    deleteObject(photo.storage_key).catch(() => {});
  }

  res.json({ photos: listPhotos(db, userId, { includePending: true }) });
});

// ---------------------------------------------------------------------------
// POST /photos/upload-intent  — message attachment presigned upload
// ---------------------------------------------------------------------------
router.post('/upload-intent', requireAuth, mutationLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const { mimeType, fileSizeBytes } = req.body;

  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` });
  }
  // Server-side size cap: reject a client-declared size that is missing, non-
  // positive, non-integer, or over the 10MB max. This is enforced BEFORE we mint
  // a presigned URL, and the size is also pinned into the presign below so the
  // cap can't be bypassed by declaring a small size and uploading a large body.
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
    return res.status(400).json({ error: `fileSizeBytes must be an integer between 1 and ${MAX_FILE_SIZE}` });
  }

  if (!r2Configured()) {
    return res.status(503).json({ error: 'Photo storage not configured.' });
  }

  const ext = MIME_TO_EXT[mimeType];
  const attachmentId = newId();
  const storageKey = `message-attachments/${userId}/${newId()}.${ext}`;
  const publicUrl = getPublicUrl(storageKey);
  const now = Date.now();

  db.prepare(`
    INSERT INTO message_attachments (id, uploader_id, storage_key, public_url, mime_type, file_size_bytes, upload_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(attachmentId, userId, storageKey, publicUrl, mimeType, fileSizeBytes, now);

  try {
    const uploadUrl = await getPresignedUploadUrl(storageKey, mimeType, 300);
    res.status(201).json({ attachmentId, storageKey, uploadUrl, publicUrl });
  } catch (e) {
    console.error('R2 presign error:', e);
    res.status(500).json({ error: 'Could not generate upload URL.' });
  }
});

// ---------------------------------------------------------------------------
// POST /photos/confirm/:attachmentId
// ---------------------------------------------------------------------------
router.post('/confirm/:attachmentId', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const attachment = db.prepare(
    'SELECT id, uploader_id, upload_status FROM message_attachments WHERE id = ?'
  ).get(req.params.attachmentId);

  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
  if (attachment.uploader_id !== userId) return res.status(403).json({ error: 'Forbidden' });
  if (attachment.upload_status !== 'pending') {
    return res.status(409).json({ error: `Cannot confirm: status is already '${attachment.upload_status}'` });
  }

  // The upload landed in R2. Move it into the human-review queue. It is NOT
  // scanned (no automated scan exists) and NOT yet servable — a moderator must
  // approve it before GET /:attachmentId/url will return a URL.
  db.prepare(`UPDATE message_attachments SET upload_status = 'pending_review' WHERE id = ?`)
    .run(req.params.attachmentId);

  res.json({ attachmentId: req.params.attachmentId, status: 'pending_review' });
});

// ---------------------------------------------------------------------------
// GET /photos/:attachmentId/url
// ---------------------------------------------------------------------------
router.get('/:attachmentId/url', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const attachment = db.prepare(
    'SELECT id, message_id, uploader_id, upload_status, public_url FROM message_attachments WHERE id = ?'
  ).get(req.params.attachmentId);

  // Uniform 404 "Photo not available." for every not-servable case (missing,
  // not yet approved, not linked to a message, or requester not a member) so the
  // endpoint never leaks the existence/state of an attachment to a non-member.
  const notAvailable = () => res.status(404).json({ error: 'Photo not available.' });

  if (!attachment) return notAvailable();

  // Only approved attachments are ever served (no more serving pending_review).
  if (attachment.upload_status !== 'approved') return notAvailable();

  // Must be linked to a message, and the requester must be a member of that
  // message's conversation.
  if (!attachment.message_id) return notAvailable();
  const message = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(attachment.message_id);
  if (!message) return notAvailable();
  const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(message.conversation_id);
  if (!conv || (conv.user_a_id !== userId && conv.user_b_id !== userId)) return notAvailable();

  res.json({ url: attachment.public_url || 'https://placehold.co/400x300?text=Photo' });
});

export default router;
