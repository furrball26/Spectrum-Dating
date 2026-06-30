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
export function listPhotos(db, userId) {
  const rows = db.prepare('SELECT id, url, description, is_primary, position FROM profile_photos WHERE user_id = ? ORDER BY position ASC, created_at ASC').all(userId);
  return rows.map(r => ({ id: r.id, url: r.url, description: r.description || '', isPrimary: !!r.is_primary, position: r.position }));
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

  db.transaction(() => {
    db.prepare(
      'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(newId(), userId, key, url, position, isFirst ? 1 : 0, now);

    if (isFirst) {
      db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?').run(url, now, userId);
    }
  })();

  return { ok: true, photos: listPhotos(db, userId) };
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
    db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?').run(photo.url, now, userId);
  })();

  res.json({ photos: listPhotos(db, userId) });
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
        'SELECT id, url FROM profile_photos WHERE user_id = ? ORDER BY position ASC, created_at ASC LIMIT 1'
      ).get(userId);
      if (next) {
        db.prepare('UPDATE profile_photos SET is_primary = 1 WHERE id = ?').run(next.id);
        db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?').run(next.url, now, userId);
      } else {
        db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?').run('', now, userId);
      }
    }
  })();

  // Best-effort delete from R2 (skip empty/legacy keys).
  if (photo.storage_key) {
    deleteObject(photo.storage_key).catch(() => {});
  }

  res.json({ photos: listPhotos(db, userId) });
});

// ---------------------------------------------------------------------------
// POST /photos/upload-intent  — message attachment presigned upload
// ---------------------------------------------------------------------------
router.post('/upload-intent', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const { mimeType, fileSizeBytes } = req.body;

  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` });
  }
  if (!fileSizeBytes || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
    return res.status(400).json({ error: 'fileSizeBytes must be between 1 and 10485760' });
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

  db.prepare(`UPDATE message_attachments SET upload_status = 'scanned', scanned_at = ? WHERE id = ?`)
    .run(Date.now(), req.params.attachmentId);

  res.json({ attachmentId: req.params.attachmentId, status: 'scanned' });
});

// ---------------------------------------------------------------------------
// GET /photos/:attachmentId/url
// ---------------------------------------------------------------------------
router.get('/:attachmentId/url', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const attachment = db.prepare(
    'SELECT id, message_id, uploader_id, upload_status, public_url FROM message_attachments WHERE id = ?'
  ).get(req.params.attachmentId);

  if (!attachment) return res.status(404).json({ error: 'Photo not available' });

  if (attachment.message_id) {
    const message = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(attachment.message_id);
    if (message) {
      const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(message.conversation_id);
      if (conv && conv.user_a_id !== userId && conv.user_b_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
  } else if (attachment.uploader_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (attachment.upload_status === 'pending' || attachment.upload_status === 'rejected') {
    return res.status(404).json({ error: 'Photo not available' });
  }

  res.json({ url: attachment.public_url || 'https://placehold.co/400x300?text=Photo' });
});

export default router;
