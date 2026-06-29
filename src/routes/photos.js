import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../utils/ids.js';
import { r2Configured, getPresignedUploadUrl, getPublicUrl, deleteObject } from '../storage/r2.js';

const router = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// POST /photos/profile-upload-url
// Returns a presigned PUT URL for a profile photo upload, plus the key
// ---------------------------------------------------------------------------
router.post('/profile-upload-url', requireAuth, async (req, res) => {
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
// POST /photos/profile-confirm
// After browser uploads to R2, call this to save the photo URL to profile
// ---------------------------------------------------------------------------
router.post('/profile-confirm', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'key is required.' });
  }
  // Validate key belongs to this user
  if (!key.startsWith(`profile-photos/${userId}/`)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  const publicUrl = getPublicUrl(key);

  // Get old photo key to delete
  const profile = db.prepare('SELECT photo_url FROM profiles WHERE user_id = ?').get(userId);
  const oldUrl = profile?.photo_url || '';

  db.prepare('UPDATE profiles SET photo_url = ?, updated_at = ? WHERE user_id = ?')
    .run(publicUrl, Date.now(), userId);

  // Delete old photo from R2 (best-effort, don't fail request if it errors)
  if (oldUrl && oldUrl !== publicUrl) {
    const oldKey = oldUrl.replace(getPublicUrl(''), '').replace(/^\//, '');
    if (oldKey) deleteObject(oldKey).catch(() => {});
  }

  res.json({ photoUrl: publicUrl });
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
