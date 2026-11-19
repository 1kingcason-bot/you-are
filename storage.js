// you are — storage layer
// Default: local disk (development / current setup).
// When B2_* environment variables are set (production on Render):
//   - JSON documents (tracks, comments, users, sessions) live in the bucket under data/
//   - media files (audio, cover, video) live in the bucket under uploads/
//   - local copies of media are deleted after a successful upload (ephemeral host disk)

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

const CLOUD = Boolean(
  process.env.B2_KEY_ID && process.env.B2_APP_KEY && process.env.B2_BUCKET && process.env.B2_REGION
);

let s3 = null;
if (CLOUD) {
  const region = process.env.B2_REGION;
  s3 = new S3Client({
    region,
    endpoint: `https://s3.${region}.backblazeb2.com`, // Backblaze's S3-compatible endpoint
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_APP_KEY
    }
  });
}

// ---------- JSON documents ----------
// one write queue per document so saves never land out of order
const writeQueues = new Map();

async function doWriteJson(key, value) {
  const json = JSON.stringify(value, null, 2);
  if (!CLOUD) {
    fs.writeFileSync(path.join(DATA_DIR, key), json);
    return;
  }
  await s3.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: `data/${key}`,
    Body: json,
    ContentType: 'application/json'
  }));
}

function writeJson(key, value) {
  const next = (writeQueues.get(key) || Promise.resolve())
    .then(() => doWriteJson(key, value))
    .catch(err => console.error(`write ${key} failed:`, err.message));
  writeQueues.set(key, next);
  return next;
}

async function readJson(key, fallback) {
  if (!CLOUD) {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA_DIR, key), 'utf8'));
    } catch {
      return fallback;
    }
  }
  try {
    const out = await s3.send(new GetObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: `data/${key}`
    }));
    return JSON.parse(await out.Body.transformToString());
  } catch (err) {
    const status = err.$metadata && err.$metadata.httpStatusCode;
    if (err.name === 'NoSuchKey' || status === 404) return fallback;
    throw err;
  }
}

// ---------- media files ----------
function mediaKey(fileName) {
  return `uploads/${fileName}`;
}

// move a finished local upload into the bucket, then free the local disk
async function putMedia(localPath, contentType) {
  if (!CLOUD) return;
  const stat = await fs.promises.stat(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: mediaKey(path.basename(localPath)),
    Body: fs.createReadStream(localPath),
    ContentLength: stat.size,
    ContentType: contentType || 'application/octet-stream'
  }));
  await fs.promises.rm(localPath, { force: true });
}

async function deleteMedia(fileName) {
  if (!fileName) return;
  if (!CLOUD) {
    fs.rm(path.join(UPLOADS_DIR, fileName), { force: true }, () => {});
    return;
  }
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: mediaKey(fileName)
    }));
  } catch (err) {
    console.error('delete media failed:', err.message);
  }
}

// freshly signed URL for a stored file (1 h validity, regenerated per request,
// so links in the feed never go stale)
async function signedUrl(fileName) {
  const command = new GetObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: mediaKey(fileName)
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

module.exports = { CLOUD, readJson, writeJson, putMedia, deleteMedia, signedUrl, DATA_DIR, UPLOADS_DIR };
