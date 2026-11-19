// seed-b2.js — one-time migration: push local data + media into Backblaze B2.
// Run WITH the B2_* environment variables set:   node seed-b2.js
// Local files are kept in place, so development keeps working afterwards.

const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { AUDIO_MIME, VIDEO_MIME, IMAGE_MIME } = storage;

if (!storage.CLOUD) {
  console.error('B2_KEY_ID / B2_APP_KEY / B2_BUCKET / B2_REGION are not set — nothing to do.');
  process.exit(1);
}

function typeFor(fileName, fallback) {
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_MIME[ext] || AUDIO_MIME[ext] || VIDEO_MIME[ext] || fallback || 'application/octet-stream';
}

(async () => {
  const tracks = JSON.parse(fs.readFileSync(path.join(storage.DATA_DIR, 'tracks.json'), 'utf8'));
  let comments = {};
  try {
    comments = JSON.parse(fs.readFileSync(path.join(storage.DATA_DIR, 'comments.json'), 'utf8'));
  } catch {}

  let uploaded = 0;
  for (const t of tracks) {
    const jobs = [];
    if (t.fileName) jobs.push([t.fileName, t.mimeType]);
    if (t.coverFile) jobs.push([t.coverFile, null]);
    if (t.videoFile) jobs.push([t.videoFile, null]);
    for (const [name, mime] of jobs) {
      const local = path.join(storage.UPLOADS_DIR, name);
      if (!fs.existsSync(local)) {
        console.log('skip (no local file):', name);
        continue;
      }
      await storage.putMedia(local, typeFor(name, mime), true); // keepLocal
      console.log('uploaded:', name);
      uploaded += 1;
    }
  }

  await storage.writeJson('tracks.json', tracks);
  await storage.writeJson('comments.json', comments);
  console.log(`seeded tracks.json + comments.json (${uploaded} media file${uploaded === 1 ? '' : 's'})`);
  console.log('users/sessions intentionally start empty — people register on the live site.');
})().catch(err => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
