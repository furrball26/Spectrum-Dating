import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET_NAME || 'spectrum-dating-photos';
const PUBLIC_URL = () => (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

export function r2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_PUBLIC_URL);
}

export async function getPresignedUploadUrl(key, contentType, expiresInSeconds = 300) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  // ContentType is baked into the signature so the client can't upload a
  // different mime than we authorized. We deliberately do NOT sign ContentLength:
  // a signed content-length makes R2 403 the PUT on any byte mismatch, which is
  // fragile across browsers and untestable without live R2. The size cap is
  // enforced server-side at /upload-intent (strict integer check vs MAX_FILE_SIZE);
  // enforce a hard object-size ceiling at the bucket level in R2 for defense-in-depth.
  const command = new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export function getPublicUrl(key) {
  return `${PUBLIC_URL()}/${key}`;
}

// Presigned, short-lived GET URL for an object. Used to serve PENDING (un-
// approved) profile audio to its owner/a moderator WITHOUT handing out a stable
// public URL: voice carries more inherent PII than a photo, so an un-reviewed
// clip must never sit behind a guessable public link. Throws when R2 isn't
// configured — callers degrade gracefully (return null, don't crash).
export async function getPresignedGetUrl(key, expiresInSeconds = 600) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  const command = new GetObjectCommand({ Bucket: BUCKET(), Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

// Fetch an object's raw bytes from the photos bucket as a Buffer. Used by the
// data export to bundle the user's own photos into the ZIP (the DB only stores
// the storage_key; the image bytes live in R2). Uses the same S3Client/config as
// uploads/deletes, so it works even if the public CDN is later locked down.
// Throws when R2 isn't configured or the object can't be read — the export
// treats that as "skip this one photo", never a whole-export failure.
export async function getObjectBytes(key) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  const out = await client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
  // AWS SDK v3 Node stream body exposes transformToByteArray(); wrap as a Buffer
  // so archiver can append it directly.
  return Buffer.from(await out.Body.transformToByteArray());
}

export async function deleteObject(key) {
  const client = getR2Client();
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

// ─── Backups ────────────────────────────────────────────────────────────────
// Backups go to a SEPARATE, PRIVATE bucket — never the public photos bucket.
// A DB dump in a public bucket would expose every user's data.

const BACKUP_BUCKET = () => process.env.R2_BACKUP_BUCKET || '';

export function backupConfigured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BACKUP_BUCKET
  );
}

export async function putBackup(key, body, contentType = 'application/octet-stream') {
  const client = getR2Client();
  if (!client || !BACKUP_BUCKET()) throw new Error('Backups not configured');
  await client.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}
