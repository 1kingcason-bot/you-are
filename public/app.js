// ---------- state ----------
let tracks = [];
let currentId = null;      // track id loaded in the player
let sortMode = 'new';
let query = '';

const $ = (sel) => document.querySelector(sel);

const audio = $('#audio');
const feed = $('#feed');
const emptyState = $('#emptyState');

// ---------- helpers ----------
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPlays(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// deterministic pastel gradient from track id
function gradientFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 65% 42%), hsl(${(h + 60) % 360} 65% 30%))`;
}

// ---------- feed ----------
function visibleTracks() {
  let list = tracks.slice();
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.genre || '').toLowerCase().includes(q)
    );
  }
  if (sortMode === 'popular') list.sort((a, b) => b.plays - a.plays);
  else if (sortMode === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
  else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function renderFeed() {
  const list = visibleTracks();
  $('#trackCount').textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
  emptyState.classList.toggle('hidden', tracks.length > 0);

  feed.innerHTML = '';
  for (const t of list) {
    const card = document.createElement('article');
    card.className = 'card' + (t.id === currentId ? ' playing' : '');
    const bg = t.coverUrl
      ? `background-image:url('${t.coverUrl}')`
      : `background:${gradientFor(t.id)}`;
    card.innerHTML = `
      <div class="thumb${t.coverUrl ? ' has-cover' : ''}" style="${bg}">
        <span class="thumb-emoji">${t.videoUrl ? '🎬' : '♪'}</span>
        <span class="duration">–</span>
        <span class="plays">▶ ${fmtPlays(t.plays)}</span>
      </div>
      <div class="card-body">
        <div class="card-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
        <div class="card-meta"><span class="card-artist" data-artist="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span> · ${fmtSize(t.size)}</div>
        ${t.genre ? `<span class="card-genre">${escapeHtml(t.genre)}</span>` : ''}
        <div class="card-actions">
          <button class="thread-btn" data-thread="${t.id}">💬 ${t.commentCount || 0}</button>
          ${canDelete(t) ? `<button class="del-btn" data-del="${t.id}">delete</button>` : ''}
        </div>
      </div>`;

    card.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      if (e.target.dataset.thread) { e.stopPropagation(); openTrackThread(t); return; }
      if (e.target.dataset.artist) { e.stopPropagation(); openArtistThread(t.artist); return; }
      if (t.videoUrl) openVideo(t);
      else playTrack(t.id);
    });
    feed.appendChild(card);
  }

  // fill in durations once metadata loads (per card, lazily)
  list.forEach((t, i) => probeDuration(t, feed.children[i]));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// only the owner sees delete; tracks made before accounts exist have no owner
function canDelete(t) {
  return !!me && (!t.ownerId || t.ownerId === me.id);
}

// ---------- video player ----------
const videoModal = $('#videoModal');
const videoEl = $('#videoPlayer');

function openVideo(t) {
  audio.pause();
  videoEl.src = t.videoUrl;
  $('#videoTitle').textContent = `${t.title} — ${t.artist}`;
  videoModal.classList.remove('hidden');
  videoEl.play().catch(() => {});

  if (currentId !== t.id) {
    currentId = t.id;
    fetch(`/api/tracks/${t.id}/plays`, { method: 'POST' })
      .then(r => r.json())
      .then(({ plays }) => { t.plays = plays; renderFeed(); })
      .catch(() => {});
    renderFeed();
  }
}

function closeVideo() {
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  videoModal.classList.add('hidden');
}

$('#videoCloseBtn').addEventListener('click', closeVideo);
videoModal.addEventListener('click', (e) => { if (e.target === videoModal) closeVideo(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !videoModal.classList.contains('hidden')) closeVideo();
});

const durationCache = {};
function probeDuration(track, card) {
  if (!card) return;
  const el = card.querySelector('.duration');
  if (durationCache[track.id]) { el.textContent = fmtTime(durationCache[track.id]); return; }
  const a = new Audio();
  a.preload = 'metadata';
  a.src = track.url;
  a.addEventListener('loadedmetadata', () => {
    durationCache[track.id] = a.duration;
    const target = feed.querySelector(`[data-duration-id="${track.id}"]`);
    a.src = ''; // release
    if (el.isConnected) el.textContent = fmtTime(a.duration);
  }, { once: true });
}

// ---------- player ----------
function playTrack(id) {
  const t = tracks.find(x => x.id === id);
  if (!t) return;

  if (currentId === id) {
    togglePlay();
    return;
  }

  currentId = id;
  audio.src = t.url;
  audio.play().catch(() => {});

  $('#player').classList.remove('hidden');
  $('#npTitle').textContent = t.title;
  $('#npArtist').textContent = t.artist;

  fetch(`/api/tracks/${id}/plays`, { method: 'POST' })
    .then(r => r.json())
    .then(({ plays }) => { t.plays = plays; renderFeed(); })
    .catch(() => {});

  renderFeed();
}

function togglePlay() {
  if (!currentId) return;
  if (audio.paused) audio.play();
  else audio.pause();
}

function stepTrack(dir) {
  if (!tracks.length) return;
  const list = visibleTracks();
  const idx = list.findIndex(t => t.id === currentId);
  const next = list[(idx + dir + list.length) % list.length];
  if (next) playTrack(next.id);
}

$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', () => stepTrack(-1));
$('#nextBtn').addEventListener('click', () => stepTrack(1));

audio.addEventListener('play', () => { $('#playBtn').textContent = '❚❚'; renderFeed(); });
audio.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; renderFeed(); });
audio.addEventListener('ended', () => stepTrack(1));

audio.addEventListener('timeupdate', () => {
  $('#curTime').textContent = fmtTime(audio.currentTime);
  if (!seekDragging && audio.duration) {
    $('#seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
  }
});

audio.addEventListener('loadedmetadata', () => {
  $('#durTime').textContent = fmtTime(audio.duration);
  if (currentId) durationCache[currentId] = audio.duration;
});

let seekDragging = false;
const seek = $('#seek');
seek.addEventListener('pointerdown', () => { seekDragging = true; });
seek.addEventListener('pointerup', () => { seekDragging = false; });
seek.addEventListener('input', () => {
  if (audio.duration) $('#curTime').textContent = fmtTime((seek.value / 1000) * audio.duration);
});
seek.addEventListener('change', () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seekDragging = false;
});

const volume = $('#volume');
audio.volume = 0.8;
volume.addEventListener('input', () => {
  audio.volume = volume.value / 100;
  audio.muted = false;
  $('#muteBtn').textContent = audio.volume === 0 ? '🔇' : '🔊';
});

$('#muteBtn').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('#muteBtn').textContent = audio.muted ? '🔇' : '🔊';
});

// ---------- search & sort ----------
$('#searchInput').addEventListener('input', (e) => { query = e.target.value.trim(); renderFeed(); });
$('#searchBtn').addEventListener('click', () => { query = $('#searchInput').value.trim(); renderFeed(); });

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    sortMode = chip.dataset.sort;
    renderFeed();
  });
});

// ---------- delete ----------
feed.addEventListener('click', (e) => {
  const id = e.target.dataset?.del;
  if (!id) return;
  e.stopPropagation();
  if (!confirm('Delete this track?')) return;
  fetch(`/api/tracks/${id}`, { method: 'DELETE' })
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { alert(data.error || 'Could not delete this track'); return; }
      tracks = tracks.filter(t => t.id !== id);
      if (currentId === id) {
        audio.pause();
        audio.removeAttribute('src');
        currentId = null;
        $('#player').classList.add('hidden');
      }
      renderFeed();
    })
    .catch(() => alert('Network error — could not delete'));
});

// ---------- comments & reactions ----------
const threadModal = $('#threadModal');
let threadKey = null;
let threadTrack = null; // track object when the thread belongs to a track
let commentEmoji = '';

const COMMENT_EMOJIS = ['❤️', '🔥', '😂', '🥺', '😍', '👏', '🙌', '🎧', '💯', '😢'];
const REACTION_SET = ['❤️', '🔥', '👏', '😮', '🎧', '🙌'];

function openTrackThread(t) {
  threadKey = t.id;
  threadTrack = t;
  $('#threadTitle').textContent = `💬 ${t.title}`;
  $('#reactionBar').classList.remove('hidden');
  showThread();
}

function openArtistThread(name) {
  threadKey = `artist:${name}`;
  threadTrack = null;
  $('#threadTitle').textContent = `❤️ Fan wall — ${name}`;
  $('#reactionBar').classList.add('hidden');
  showThread();
}

function showThread() {
  $('#threadText').value = '';
  $('#threadHint').textContent = '';
  commentEmoji = '';
  renderEmojiPicker();
  threadModal.classList.remove('hidden');
  if (threadTrack) renderReactions();
  loadThread();
  setTimeout(() => $('#threadText').focus(), 50);
}

function closeThread() {
  threadModal.classList.add('hidden');
  threadTrack = null;
}

$('#threadCloseBtn').addEventListener('click', closeThread);
threadModal.addEventListener('click', e => { if (e.target === threadModal) closeThread(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !threadModal.classList.contains('hidden')) closeThread();
});

function renderReactions() {
  const bar = $('#reactionBar');
  const r = (threadTrack && threadTrack.reactions) || {};
  bar.innerHTML = REACTION_SET.map(e =>
    `<button class="reaction" data-react="${e}" title="React">${e}<span>${r[e] || 0}</span></button>`
  ).join('');
}

$('#reactionBar').addEventListener('click', async e => {
  const btn = e.target.closest('[data-react]');
  if (!btn || !threadTrack) return;
  if (!requireLogin()) return;
  try {
    const res = await fetch(`/api/tracks/${threadTrack.id}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: btn.dataset.react })
    });
    if (res.ok) {
      const { reactions } = await res.json();
      threadTrack.reactions = reactions;
      renderReactions();
    } else if (res.status === 401) {
      openAuth('login');
    }
  } catch {}
});

function renderEmojiPicker() {
  $('#emojiPicker').innerHTML = COMMENT_EMOJIS.map(e =>
    `<button type="button" class="emoji-pick${e === commentEmoji ? ' active' : ''}" data-emoji="${e}">${e}</button>`
  ).join('');
}

$('#emojiPicker').addEventListener('click', e => {
  const btn = e.target.closest('[data-emoji]');
  if (!btn) return;
  commentEmoji = commentEmoji === btn.dataset.emoji ? '' : btn.dataset.emoji;
  renderEmojiPicker();
});

async function loadThread() {
  const listEl = $('#threadList');
  listEl.innerHTML = '<p class="thread-empty">Loading…</p>';
  try {
    const res = await fetch(`/api/comments/${encodeURIComponent(threadKey)}`);
    const list = await res.json();
    if (!list.length) {
      listEl.innerHTML = '<p class="thread-empty">No comments yet — be the first! 💬</p>';
      return;
    }
    listEl.innerHTML = list.slice().reverse().map(c => {
      const own = me && (!c.userId || c.userId === me.id);
      return `
      <div class="comment">
        <div class="comment-head">
          <strong>${escapeHtml(c.name)}</strong>
          <span class="comment-head-right">
            <span class="comment-time">${new Date(c.createdAt).toLocaleDateString()}</span>
            ${own ? `<button class="comment-del" data-cdel="${c.id}" aria-label="Delete comment">✕</button>` : ''}
          </span>
        </div>
        <p>${c.emoji ? `<span class="comment-emoji">${c.emoji}</span> ` : ''}${escapeHtml(c.text)}</p>
      </div>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<p class="thread-empty">Could not load comments.</p>';
  }
}

$('#threadPostBtn').addEventListener('click', postComment);
$('#threadText').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment();
});

// delete your own comments
$('#threadList').addEventListener('click', async (e) => {
  const id = e.target.dataset?.cdel;
  if (!id || !threadKey) return;
  if (!confirm('Delete this comment?')) return;
  try {
    const res = await fetch(`/api/comments/${encodeURIComponent(threadKey)}/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (threadTrack) {
        threadTrack.commentCount = Math.max(0, (threadTrack.commentCount || 1) - 1);
        renderFeed();
      }
      loadThread();
    } else {
      const err = await res.json().catch(() => ({}));
      $('#threadHint').textContent = err.error || 'Could not delete';
    }
  } catch {
    $('#threadHint').textContent = 'Network error';
  }
});

async function postComment() {
  const text = $('#threadText').value.trim();
  if (!threadKey) return;
  if (!text) { $('#threadHint').textContent = 'Write something first'; return; }
  if (!requireLogin(postComment)) { $('#threadHint').textContent = 'Log in to comment'; return; }
  $('#threadPostBtn').disabled = true;
  try {
    const res = await fetch(`/api/comments/${encodeURIComponent(threadKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, emoji: commentEmoji })
    });
    if (res.ok) {
      $('#threadText').value = '';
      commentEmoji = '';
      renderEmojiPicker();
      if (threadTrack) {
        threadTrack.commentCount = (threadTrack.commentCount || 0) + 1;
        renderFeed();
      }
      loadThread();
    } else {
      const err = await res.json().catch(() => ({}));
      $('#threadHint').textContent = err.error || 'Failed to post';
      if (res.status === 401) openAuth('login');
    }
  } catch {
    $('#threadHint').textContent = 'Network error';
  }
  $('#threadPostBtn').disabled = false;
}

// ---------- auth: everyone gets their own login ----------
let me = null;
let authMode = 'login';
let authAfter = null; // action to run after a successful login/signup

const authModal = $('#authModal');

function renderAuthUI() {
  $('#accountBtn').textContent = me ? `@${me.username}` : 'Log in';
  $('#logoutBtn').classList.toggle('hidden', !me);
  $('#threadAs').textContent = me ? `Commenting as @${me.username}` : 'Log in to join the conversation';
  renderFeed();
}

function setAuthMode(mode) {
  authMode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'Log in' : 'Create your account';
  $('#authTabLogin').classList.toggle('active', mode === 'login');
  $('#authTabSignup').classList.toggle('active', mode === 'signup');
  $('#authSubmitBtn').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  $('#authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authError').classList.add('hidden');
}

function openAuth(mode = 'login', after = null) {
  authAfter = after;
  setAuthMode(mode);
  authModal.classList.remove('hidden');
  setTimeout(() => $('#authUser').focus(), 60);
}

function closeAuth() {
  authModal.classList.add('hidden');
  authAfter = null;
}

// returns true when logged in; otherwise opens the login modal (and runs
// `after` once the user is logged in)
function requireLogin(after) {
  if (me) return true;
  openAuth('login', after || null);
  return false;
}

$('#accountBtn').addEventListener('click', () => { if (!me) openAuth('login'); });
$('#logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  me = null;
  renderAuthUI();
});
$('#authCloseBtn').addEventListener('click', closeAuth);
$('#authCancelBtn').addEventListener('click', closeAuth);
authModal.addEventListener('click', e => { if (e.target === authModal) closeAuth(); });
$('#authTabLogin').addEventListener('click', () => setAuthMode('login'));
$('#authTabSignup').addEventListener('click', () => setAuthMode('signup'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !authModal.classList.contains('hidden')) closeAuth();
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#authError');
  errEl.classList.add('hidden');
  const btn = $('#authSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/auth/${authMode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#authUser').value.trim(), password: $('#authPass').value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.error || 'Something went wrong';
      errEl.classList.remove('hidden');
      return;
    }
    me = data.user;
    $('#authPass').value = '';
    const after = authAfter;
    closeAuth();
    renderAuthUI();
    if (after) after();
  } catch {
    errEl.textContent = 'Network error — check your connection';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

// ---------- upload modal ----------
const modal = $('#uploadModal');
const fileInput = $('#fileInput');
const dropZone = $('#dropZone');
let selectedFile = null;

function openUploadModal() {
  if (!requireLogin(openUploadModal)) return; // ask for a login first
  modal.classList.remove('hidden');
}
$('#uploadOpenBtn').addEventListener('click', openUploadModal);
document.querySelectorAll('[data-open-upload]').forEach(btn =>
  btn.addEventListener('click', openUploadModal)
);
$('#uploadCloseBtn').addEventListener('click', closeModal);
$('#uploadCancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

function closeModal() {
  modal.classList.add('hidden');
  resetUploadForm();
}

function resetUploadForm() {
  $('#uploadForm').reset();
  selectedFile = null;
  coverFile = null;
  videoFile = null;
  ['coverLabel', 'videoLabel'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.textContent = i === 0 ? 'Cover art — optional' : 'Music video — mp4/webm · ≤100 MB';
  });
  ['coverPick', 'videoPick'].forEach(id => document.getElementById(id).classList.remove('picked'));
  $('#dropSelected').classList.add('hidden');
  $('.drop-idle').classList.remove('hidden');
  updateSubmitState();
  $('#uploadError').classList.add('hidden');
  $('#uploadProgress').classList.add('hidden');
  $('#progressBar').style.width = '0%';
}

function updateSubmitState() {
  $('#uploadSubmitBtn').disabled = !(selectedFile && $('#rightsCheck').checked);
}

$('#rightsCheck').addEventListener('change', updateSubmitState);

dropZone.addEventListener('click', () => fileInput.click());

// cover + video pickers
let coverFile = null;
let videoFile = null;

function bindMediaPicker(inputId, labelId, pickId, setFile) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  const pick = document.getElementById(pickId);
  const idle = label.textContent;
  input.addEventListener('change', () => {
    const f = input.files[0] || null;
    setFile(f);
    label.textContent = f ? f.name : idle;
    pick.classList.toggle('picked', !!f);
  });
}

bindMediaPicker('coverInput', 'coverLabel', 'coverPick', f => { coverFile = f; });
bindMediaPicker('videoInput', 'videoLabel', 'videoPick', f => { videoFile = f; });

['dragover', 'dragenter'].forEach(ev =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach(ev =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
);
dropZone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) setFile(f);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

function setFile(f) {
  const typeOk = f.type.startsWith('audio') || f.type.startsWith('video');
  const extOk = /\.(mp3|wav|ogg|oga|opus|m4a|m4b|mp4|webm|flac|aac|wma|aiff|aif|ape|amr|au|snd|mka|mid|midi|ac3|mpc|3gp|mov|m4v|mkv|avi)$/i.test(f.name);
  if (!typeOk && !extOk) {
    showUploadError('That doesn\'t look like an audio or video file.');
    return;
  }
  selectedFile = f;
  $('#selectedName').textContent = `${f.name} · ${fmtSize(f.size)}`;
  $('.drop-idle').classList.add('hidden');
  $('#dropSelected').classList.remove('hidden');
  updateSubmitState();
  $('#uploadError').classList.add('hidden');
}

function showUploadError(msg) {
  const el = $('#uploadError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#uploadForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!selectedFile) return;

  const fd = new FormData();
  fd.append('audio', selectedFile);
  if (coverFile) fd.append('cover', coverFile);
  if (videoFile) fd.append('video', videoFile);
  const form = new FormData(e.target);
  ['title', 'artist', 'genre', 'description'].forEach(k => {
    if (form.get(k)) fd.append(k, form.get(k));
  });
  fd.append('rights', $('#rightsCheck').checked ? '1' : '');

  const xhr = new XMLHttpRequest();
  $('#uploadProgress').classList.remove('hidden');
  $('#uploadSubmitBtn').disabled = true;
  $('#uploadSubmitBtn').textContent = 'Uploading…';

  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable) {
      $('#progressBar').style.width = `${(ev.loaded / ev.total) * 100}%`;
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const track = JSON.parse(xhr.responseText);
      tracks.unshift(track);
      closeModal();
      renderFeed();
      playTrack(track.id);
    } else {
      let msg = 'Upload failed';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      showUploadError(msg);
      updateSubmitState();
    }
    $('#uploadSubmitBtn').textContent = 'Publish';
  });

  xhr.addEventListener('error', () => {
    showUploadError('Network error — is the server running?');
    updateSubmitState();
    $('#uploadSubmitBtn').textContent = 'Publish';
  });

  xhr.open('POST', '/api/tracks');
  xhr.send(fd);
});

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.shiftKey) stepTrack(1);
  if (e.code === 'ArrowLeft' && e.shiftKey) stepTrack(-1);
});

// ---------- init ----------
async function init() {
  try {
    const [tRes, meRes] = await Promise.all([
      fetch('/api/tracks'),
      fetch('/api/auth/me')
    ]);
    tracks = await tRes.json();
    const meData = await meRes.json().catch(() => ({ user: null }));
    me = meData.user || null;
  } catch {
    showUploadError('Could not reach the server.');
  }
  renderAuthUI(); // also renders the feed
}

init();

// ---------- PWA: register service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
