import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
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

// Set the photos bucket's CORS policy so browsers can PUT to presigned upload
// URLs from the app origin (required for in-browser photo uploads).
export async function putPhotosBucketCors(origins) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  await client.send(new PutBucketCorsCommand({
    Bucket: BUCKET(),
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      }],
    },
  }));
}

export async function getPresignedUploadUrl(key, contentType, expiresInSeconds = 300) {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');
  const command = new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType });
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
