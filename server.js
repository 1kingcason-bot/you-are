const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const UPLOADS_DIR = storage.UPLOADS_DIR;
const DATA_DIR = storage.DATA_DIR;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- track store (loaded at boot) ----------
let tracks = [];

function saveTracks(list) {
  return storage.writeJson('tracks.json', list);
}

// ---------- comment store (keys: track id or "artist:<name>") ----------
let comments = {};

function saveComments() {
  return storage.writeJson('comments.json', comments);
}
const REACTION_EMOJIS = ['❤️', '🔥', '👏', '😮', '🎧', '🙌'];
// comment emoji picker offers a wider set than track reactions
const COMMENT_EMOJIS = ['❤️', '🔥', '😂', '🥺', '😍', '👏', '🙌', '🎧', '💯', '😢'];

// ---------- users & sessions (everyone gets their own login) ----------
const SESSION_COOKIE = 'youare_session';
const SESSION_DAYS = 90;

// loaded at boot
let users = [];
let sessions = {};

function saveUsers() {
  return storage.writeJson('users.json', users);
}

function saveSessions() {
  return storage.writeJson('sessions.json', sessions);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return test.length === expected.length && crypto.timingSafeEqual(test, expected);
}

function publicUser(u) {
  return { id: u.id, username: u.username, createdAt: u.createdAt };
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  saveSessions();
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function endSession(req, res) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token && sessions[token]) {
    delete sessions[token];
    saveSessions();
  }
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}

function userFromRequest(req) {
  const token = readCookie(req, SESSION_COOKIE);
  const session = token && sessions[token];
  if (!session) return null;
  const user = users.find(u => u.id === session.userId);
  return user ? publicUser(user) : null;
}

// attach the logged-in user (if any) to every request
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use((req, res, next) => {
  req.user = userFromRequest(req);
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in required' });
  next();
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username: 3–30 letters, numbers, _ or -' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'That username is taken' });
  }
  const user = {
    id: crypto.randomBytes(6).toString('hex'),
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers();
  startSession(req, res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user || null });
});

// ---------- upload ----------
// accept essentially every audio/video container format browsers + users throw at us
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.mp4': 'audio/mp4',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.webm': 'audio/webm', '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.ape': 'audio/x-ape', '.amr': 'audio/amr',
  '.au': 'audio/basic', '.snd': 'audio/basic', '.mka': 'audio/x-matroska',
  '.mid': 'audio/midi', '.midi': 'audio/midi', '.ac3': 'audio/ac3', '.mpc': 'audio/musepack'
};
const VIDEO_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp', '.mts': 'video/mp2t', '.ts': 'video/mp2t'
};

const diskStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const AUDIO_EXT = Object.keys(AUDIO_MIME);
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const IMAGE_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp'
};
const VIDEO_EXT = Object.keys(VIDEO_MIME);

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 220 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (file.fieldname === 'audio') {
      if (mime.startsWith('audio/') || AUDIO_EXT.includes(ext)) return cb(null, true);
      // browsers often label mp4/webm as video/ even for music tracks
      if (mime.startsWith('video/') && (ext === '.mp4' || ext === '.webm' || ext === '.m4a')) return cb(null, true);
      return cb(new Error('That file type is not accepted as audio'));
    }
    if (file.fieldname === 'cover') {
      if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return cb(null, true);
      return cb(new Error('Cover art must be an image (jpg, png, webp…)'));
    }
    if (file.fieldname === 'video') {
      if (mime.startsWith('video/') || VIDEO_EXT.includes(ext)) return cb(null, true);
      return cb(new Error('Video must be a video file (mp4, webm, mov…)'));
    }
    cb(new Error('Unexpected file field'));
  }
});

// ---------- API ----------
function trackView(t) {
  return {
    ...t,
    fileName: undefined,
    coverFile: undefined,
    videoFile: undefined,
    url: `/api/tracks/${t.id}/audio`,
    coverUrl: t.coverFile ? `/api/tracks/${t.id}/cover` : null,
    videoUrl: t.videoFile ? `/api/tracks/${t.id}/video` : null,
    ownerId: t.ownerId || null,
    ownerName: t.ownerName || null,
    reactions: t.reactions || {},
    commentCount: (comments[t.id] || []).length
  };
}

function findFile(req, field) {
  const track = tracks.find(t => t.id === req.params.id);
  if (!track) return { track: null };
  const name = track[field];
  if (!name) return { track, missing: true };
  const filePath = path.join(UPLOADS_DIR, name);
  // in cloud mode the local copy is gone by design (it lives in the bucket)
  if (!storage.CLOUD && !fs.existsSync(filePath)) return { track, missing: true };
  return { track, filePath };
}

app.get('/api/tracks', (req, res) => {
  res.json(tracks.map(trackView));
});

app.post('/api/tracks', requireAuth, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
  { name: 'video', maxCount: 1 }
]), async (req, res) => {
  const files = req.files || {};
  const audio = (files.audio || [])[0];
  const cover = (files.cover || [])[0];
  const video = (files.video || [])[0];

  const cleanup = () => {
    [audio, cover, video].forEach(f => {
      if (f) fs.rm(path.join(UPLOADS_DIR, f.filename), { force: true }, () => {});
    });
  };

  if (!audio) return res.status(400).json({ error: 'No audio file provided' });
  if (req.body.rights !== '1') {
    cleanup();
    return res.status(400).json({ error: 'You must confirm you own the rights to this track' });
  }
  if (audio.size > 60 * 1024 * 1024) {
    cleanup();
    return res.status(400).json({ error: 'Audio must be 60 MB or smaller' });
  }
  if (cover && cover.size > 10 * 1024 * 1024) {
    cleanup();
    return res.status(400).json({ error: 'Cover art must be 10 MB or smaller' });
  }
  // kept at 100 MB so uploads fit under the public link's ~100 MB request cap
  if (video && video.size > 100 * 1024 * 1024) {
    cleanup();
    return res.status(400).json({ error: 'Video must be 100 MB or smaller' });
  }
  // the whole upload travels as one request, and public links cap near 100 MB
  const totalSize = audio.size + (cover ? cover.size : 0) + (video ? video.size : 0);
  if (totalSize > 95 * 1024 * 1024) {
    cleanup();
    return res.status(400).json({
      error: 'Audio + cover + video together must be 95 MB or smaller — try a shorter video'
    });
  }

  // persist media to cloud storage when enabled (frees the local temp copies)
  try {
    await Promise.all([
      storage.putMedia(path.join(UPLOADS_DIR, audio.filename),
        AUDIO_MIME[path.extname(audio.filename).toLowerCase()] || audio.mimetype),
      cover && storage.putMedia(path.join(UPLOADS_DIR, cover.filename),
        IMAGE_MIME[path.extname(cover.filename).toLowerCase()] || cover.mimetype),
      video && storage.putMedia(path.join(UPLOADS_DIR, video.filename),
        VIDEO_MIME[path.extname(video.filename).toLowerCase()] || video.mimetype)
    ]);
  } catch (err) {
    console.error('media upload failed:', err.message);
    cleanup();
    [audio, cover, video].forEach(f => { if (f) storage.deleteMedia(f.filename); });
    return res.status(500).json({ error: 'Could not store the files — please try again' });
  }

  const track = {
    id: crypto.randomBytes(6).toString('hex'),
    title: (req.body.title || '').trim() || path.parse(audio.originalname).name,
    artist: (req.body.artist || '').trim() || 'Unknown artist',
    description: (req.body.description || '').trim(),
    genre: (req.body.genre || '').trim(),
    payout: (req.body.payout || '').trim().slice(0, 80),
    fileName: audio.filename,
    originalName: audio.originalname,
    mimeType: audio.mimetype,
    size: audio.size,
    coverFile: cover ? cover.filename : null,
    videoFile: video ? video.filename : null,
    ownerId: req.user.id,
    ownerName: req.user.username,
    plays: 0,
    createdAt: new Date().toISOString()
  };

  tracks.unshift(track);
  saveTracks(tracks);
  res.status(201).json(trackView(track));
});

app.get('/api/tracks/:id/audio', async (req, res) => {
  const track = tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // derive a proper content-type from the extension (browsers ignore generic types)
  const ext = path.extname(track.fileName).toLowerCase();
  const type = AUDIO_MIME[ext] || track.mimeType || 'audio/mpeg';

  if (storage.CLOUD) {
    // fresh signed URL per request — the bucket handles Range requests/seeking
    try {
      return res.redirect(await storage.signedUrl(track.fileName));
    } catch (err) {
      console.error('sign url failed:', err.message);
      return res.status(502).json({ error: 'Could not load file' });
    }
  }

  const filePath = path.join(UPLOADS_DIR, track.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  // res.sendFile supports HTTP Range requests (streaming/seeking)
  res.sendFile(filePath, { headers: { 'Content-Type': type } });
});

app.get('/api/tracks/:id/cover', async (req, res) => {
  const { track, filePath, missing } = findFile(req, 'coverFile');
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (missing) return res.status(404).json({ error: 'No cover art' });
  if (storage.CLOUD) {
    try {
      return res.redirect(await storage.signedUrl(track.coverFile));
    } catch (err) {
      console.error('sign url failed:', err.message);
      return res.status(502).json({ error: 'Could not load file' });
    }
  }
  res.sendFile(filePath);
});

app.get('/api/tracks/:id/video', async (req, res) => {
  const { track, filePath, missing } = findFile(req, 'videoFile');
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (missing) return res.status(404).json({ error: 'No video' });
  if (storage.CLOUD) {
    try {
      return res.redirect(await storage.signedUrl(track.videoFile));
    } catch (err) {
      console.error('sign url failed:', err.message);
      return res.status(502).json({ error: 'Could not load file' });
    }
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = VIDEO_MIME[ext] ? { 'Content-Type': VIDEO_MIME[ext] } : {};
  res.sendFile(filePath, { headers }); // sendFile supports Range requests → video scrubbing works
});

app.post('/api/tracks/:id/plays', (req, res) => {
  const track = tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  track.plays += 1;
  saveTracks(tracks);
  res.json({ plays: track.plays });
});

// ---------- comments & reactions ----------
app.get('/api/comments/:key', (req, res) => {
  res.json(comments[req.params.key] || []);
});

app.post('/api/comments/:key', requireAuth, (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  const emoji = COMMENT_EMOJIS.includes(req.body.emoji) ? req.body.emoji : '';
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });

  const comment = {
    id: crypto.randomBytes(5).toString('hex'),
    userId: req.user.id,
    name: req.user.username, // comments always show the logged-in account
    text, emoji,
    createdAt: new Date().toISOString()
  };
  (comments[req.params.key] ||= []).push(comment);
  saveComments();
  res.status(201).json(comment);
});

app.delete('/api/comments/:key/:id', requireAuth, (req, res) => {
  const list = comments[req.params.key] || [];
  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Comment not found' });
  const comment = list[idx];
  if (comment.userId && comment.userId !== req.user.id) {
    return res.status(403).json({ error: 'Only the author can delete this comment' });
  }
  list.splice(idx, 1);
  saveComments();
  res.json({ ok: true });
});

app.post('/api/tracks/:id/react', requireAuth, (req, res) => {
  const track = tracks.find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const emoji = req.body.emoji;
  if (!REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction' });
  track.reactions = track.reactions || {};
  track.reactions[emoji] = (track.reactions[emoji] || 0) + 1;
  saveTracks(tracks);
  res.json({ reactions: track.reactions });
});

app.delete('/api/tracks/:id', requireAuth, (req, res) => {
  const idx = tracks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Track not found' });

  // owner-only; tracks uploaded before accounts exist have no owner and
  // can be removed by any logged-in user
  if (tracks[idx].ownerId && tracks[idx].ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the owner can delete this track' });
  }

  const [removed] = tracks.splice(idx, 1);
  saveTracks(tracks);
  [removed.fileName, removed.coverFile, removed.videoFile].forEach(name => storage.deleteMedia(name));
  res.json({ ok: true });
});

// multer / generic error handler
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE'
    ? 'A file is too large — audio ≤ 60 MB, cover ≤ 10 MB, video ≤ 100 MB'
    : err.message || 'Upload failed';
  res.status(400).json({ error: msg });
});

async function boot() {
  try {
    tracks = await storage.readJson('tracks.json', []);
    comments = await storage.readJson('comments.json', {});
    users = await storage.readJson('users.json', []);
    sessions = await storage.readJson('sessions.json', {});
  } catch (err) {
    console.error('Could not load data:', err.message);
    process.exit(1);
  }

  // drop sessions older than the window
  const cutoff = Date.now() - SESSION_DAYS * 86400000;
  for (const [token, s] of Object.entries(sessions)) {
    if (new Date(s.createdAt).getTime() < cutoff) delete sessions[token];
  }

  app.listen(PORT, () => {
    const mode = storage.CLOUD ? 'cloud storage (B2)' : 'local storage';
    console.log(`you are running at http://localhost:${PORT} — ${mode}`);
  });
}

boot();
