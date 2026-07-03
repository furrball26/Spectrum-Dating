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

export async function getPresignedUploadUrl(key, contentType, expiresInSeconds = 300, contentLength = null) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  // ContentType is baked into the signature so the client can't upload a
  // different mime than we authorized. When a contentLength is supplied it is
  // signed too (SignableHeaders includes content-length), so the presigned PUT
  // only accepts a body of EXACTLY that size — the 10MB cap stops being merely
  // advisory and can't be exceeded by a lying client.
  const params = { Bucket: BUCKET(), Key: key, ContentType: contentType };
  if (contentLength != null) params.ContentLength = contentLength;
  const command = new PutObjectCommand(params);
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export function getPublicUrl(key) {
  return `${PUBLIC_URL()}/${key}`;
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
