// Shared account-deletion cascade. Extracted from DELETE /account/me so both
// self-delete and the admin test-account purge use ONE audited path.
//
// Right-to-erasure detail: object-storage keys (profile photos, message
// attachments) are collected BEFORE the DB rows are removed, then deleted from
// R2 AFTER the surrounding DB transaction commits. R2 cleanup is best-effort —
// a storage error must never roll back (or block) the account deletion itself.
import { deleteObject } from '../storage/r2.js';

// Collect a user's R2 object keys and delete ALL their DB rows, synchronously.
// Returns the storage keys to remove from R2 after the transaction commits.
// Does NOT open its own transaction — safe to call inside an outer
// db.transaction() (e.g. the bulk admin purge), or wrap it yourself via
// deleteUserCascade() for a single user.
export function deleteUserRows(db, userId) {
  const photoKeys = db.prepare(
    'SELECT storage_key FROM profile_photos WHERE user_id = ? AND storage_key IS NOT NULL AND storage_key != ?'
  ).all(userId, '').map(r => r.storage_key);

  let attachmentKeys = [];
  try {
    attachmentKeys = db.prepare(
      'SELECT storage_key FROM message_attachments WHERE uploader_id = ? AND storage_key IS NOT NULL AND storage_key != ?'
    ).all(userId, '').map(r => r.storage_key);
  } catch {
    // message_attachments may not exist / be relevant in all deployments.
    attachmentKeys = [];
  }

  // Profile audio: collect the R2 keys BEFORE the ON DELETE CASCADE FK removes
  // the rows, else the voice recordings orphan in the bucket on account delete.
  let audioKeys = [];
  try {
    audioKeys = db.prepare(
      'SELECT storage_key FROM profile_audio WHERE user_id = ? AND storage_key IS NOT NULL AND storage_key != ?'
    ).all(userId, '').map(r => r.storage_key);
  } catch {
    // profile_audio may not exist on a not-yet-migrated deployment.
    audioKeys = [];
  }

  const storageKeys = [...new Set([...photoKeys, ...attachmentKeys, ...audioKeys])];

  // Foreign keys with ON DELETE CASCADE handle profiles, interests, swipes,
  // matches, conversations, messages, reactions, blocks, push_subscriptions.
  // We still delete the two-column-referencing tables explicitly (defensive —
  // matches/conversations/swipes/blocks reference the user via two columns).
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM matches WHERE user_a_id = ? OR user_b_id = ?').run(userId, userId);
  db.prepare('DELETE FROM conversations WHERE user_a_id = ? OR user_b_id = ?').run(userId, userId);
  db.prepare('DELETE FROM swipes WHERE swiper_id = ? OR swiped_id = ?').run(userId, userId);
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(userId, userId);
  db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  return storageKeys;
}

// Best-effort R2 object cleanup for a set of storage keys. Never awaited/blocking
// and never able to fail the request (the DB rows are already gone).
export function purgeStorageObjects(keys) {
  for (const key of keys) {
    deleteObject(key).catch((err) => {
      console.error('[delete-user] failed to delete R2 object', key, '-', err?.message);
    });
  }
}

// Delete a single user in its own transaction, then fire the R2 cleanup.
// Returns the storage keys that were scheduled for removal.
export function deleteUserCascade(db, userId) {
  let storageKeys = [];
  const tx = db.transaction((uid) => {
    storageKeys = deleteUserRows(db, uid);
  });
  tx(userId);
  purgeStorageObjects(storageKeys);
  return storageKeys;
}
