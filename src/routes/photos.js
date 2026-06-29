import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../utils/ids.js';

const router = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// POST /photos/upload-intent
// ---------------------------------------------------------------------------

router.post('/upload-intent', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { mimeType, fileSizeBytes } = req.body;

  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of: ${[...ALLOWED_MIME].join(', ')}` });
  }
  if (!fileSizeBytes || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
    return res.status(400).json({ error: 'fileSizeBytes must be between 1 and 10485760' });
  }

  const attachmentId = newId();
  const storageKey = `uploads/${newId()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO message_attachments (id, uploader_id, storage_key, mime_type, file_size_bytes, upload_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(attachmentId, userId, storageKey, mimeType, fileSizeBytes, now);

  // In production: return a pre-signed S3 upload URL.
  // For the prototype, return a stub endpoint.
  const uploadUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/photos/stub-upload`;

  res.status(201).json({ attachmentId, storageKey, uploadUrl });
});

// ---------------------------------------------------------------------------
// POST /photos/stub-upload  — simulates S3 PUT endpoint (prototype only)
// ---------------------------------------------------------------------------

router.post('/stub-upload', (_req, res) => {
  // No auth, no storage — just acknowledges receipt for prototype testing.
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /photos/confirm/:attachmentId  — advance status to 'scanned'
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

  const now = Date.now();
  db.prepare(
    `UPDATE message_attachments SET upload_status = 'scanned', scanned_at = ? WHERE id = ?`
  ).run(now, req.params.attachmentId);

  res.json({ attachmentId: req.params.attachmentId, status: 'scanned' });
});

// ---------------------------------------------------------------------------
// GET /photos/:attachmentId/url  — return stub URL if available
// ---------------------------------------------------------------------------

router.get('/:attachmentId/url', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const attachment = db.prepare(
    'SELECT id, message_id, uploader_id, upload_status FROM message_attachments WHERE id = ?'
  ).get(req.params.attachmentId);

  if (!attachment) return res.status(404).json({ error: 'Photo not available' });

  // Verify requester is in the same conversation (if attachment is linked to a message)
  if (attachment.message_id) {
    const message = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(attachment.message_id);
    if (message) {
      const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(message.conversation_id);
      if (conv && conv.user_a_id !== userId && conv.user_b_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
  } else if (attachment.uploader_id !== userId) {
    // Unlinked attachment — only the uploader can access
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Only approved or scanned (prototype) attachments get a URL
  if (attachment.upload_status === 'pending' || attachment.upload_status === 'rejected') {
    return res.status(404).json({ error: 'Photo not available' });
  }

  // In production: generate a short-lived signed URL from the object store.
  // For the prototype: return a stub placeholder.
  res.json({ url: 'https://placehold.co/400x300?text=Photo' });
});

export default router;
