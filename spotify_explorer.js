/**
 * Spotify Library Explorer v3
 *
 * Usage:
 *   1. Fill in CLIENT_ID and CLIENT_SECRET below
 *   2. Run: node spotify_explorer.js
 *   3. Open http://127.0.0.1:8888 in your browser
 *   4. Click "connect Spotify"
 *   5. Click "fetch library"
 *   6. Next time, opens from cache automatically
 *
 * Requires Node.js 18+. No npm install needed.
 */

const YOUR_NAME     = 'your name here';  // shown in the page header
const CLIENT_ID     = 'YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const PORT = 8888;
const CACHE_FILE = './spotify_cache.json';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

let accessToken = null;
let refreshToken = null;
let tokenExpiry = 0;
let codeVerifier = '';
let loadProgress = { status: 'idle', message: '' };
let libraryCache = null;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function generateCodeVerifier() { return base64url(crypto.randomBytes(32)); }
function generateCodeChallenge(v) { return base64url(crypto.createHash('sha256').update(v).digest()); }

function spotifyGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.spotify.com', path, method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('token_expired'));
        if (res.statusCode === 429) return reject(new Error('rate_limited'));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function spotifyPost(hostname, path, body, isJson) {
  return new Promise((resolve, reject) => {
    const b = isJson ? JSON.stringify(body) : new URLSearchParams(body).toString();
    const ct = isJson ? 'application/json' : 'application/x-www-form-urlencoded';
    const headers = {
      'Content-Type': ct,
      'Content-Length': Buffer.byteLength(b)
    };
    if (!isJson) headers['Authorization'] = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    else headers['Authorization'] = `Bearer ${accessToken}`;
    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); } catch(e) { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

function spotifyApiPost(path, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.spotify.com', path, method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); } catch(e) { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

async function refreshAccessToken() {
  const data = await spotifyPost('accounts.spotify.com', '/api/token', {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID
  });
  accessToken = data.body.access_token;
  tokenExpiry = Date.now() + (data.body.expires_in - 60) * 1000;
  if (data.body.refresh_token) refreshToken = data.body.refresh_token;
}

async function ensureToken() {
  if (Date.now() > tokenExpiry) await refreshAccessToken();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeGet(path, retries=3) {
  for (let i = 0; i < retries; i++) {
    try { await ensureToken(); return await spotifyGet(path); }
    catch(e) {
      if (e.message === 'rate_limited') { await sleep(2000 * (i+1)); continue; }
      if (e.message === 'token_expired') { await refreshAccessToken(); continue; }
      throw e;
    }
  }
}

function getAlbumImage(album) {
  if (!album || !album.images || !album.images.length) return '';
  const img = album.images.find(i => i.width && i.width <= 64) || album.images[album.images.length - 1];
  return img ? img.url : '';
}

async function fetchAllLikedTracks() {
  const tracks = [];
  let next = '/v1/me/tracks?limit=50';
  let page = 0;
  while (next && page < 40) {
    const data = await safeGet(next.replace('https://api.spotify.com',''));
    data.items.forEach(item => {
      const t = item.track;
      if (!t || !t.id) return;
      tracks.push({
        id: t.id,
        name: t.name,
        artists: t.artists.map(a => a.name),
        artist_ids: t.artists.map(a => a.id),
        album_name: t.album.name,
        album_id: t.album.id,
        album_type: t.album.album_type || '',
        album_total_tracks: t.album.total_tracks || null,
        album_image: getAlbumImage(t.album),
        release_date: t.album.release_date || '',
        year: parseInt((t.album.release_date||'0').slice(0,4)) || null,
        track_number: t.track_number || null,
        disc_number: t.disc_number || null,
        duration_ms: t.duration_ms || null,
        explicit: t.explicit || false,
        popularity: t.popularity != null ? t.popularity : null,
        isrc: (t.external_ids && t.external_ids.isrc) ? t.external_ids.isrc : '',
        preview_url: t.preview_url || '',
        uri: t.uri || '',
        spotify_url: (t.external_urls && t.external_urls.spotify) ? t.external_urls.spotify : '',
        liked: true,
        liked_at: item.added_at || '',
        playlists: [],
        playlist_added_at: {},
        genres: [],
        artist_popularity: null,
        top_short_rank: null,
        top_medium_rank: null,
        top_long_rank: null
      });
    });
    next = data.next;
    page++;
  }
  return tracks;
}

async function fetchAllPlaylists() {
  const playlists = [];
  let next = '/v1/me/playlists?limit=50';
  while (next) {
    const data = await safeGet(next.replace('https://api.spotify.com',''));
    data.items.forEach(p => { if (p) playlists.push({ id: p.id, name: p.name }); });
    next = data.next;
  }
  return playlists;
}

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];
  let next = `/v1/playlists/${playlistId}/items?limit=100&fields=next,items(added_at,track(id,name,artists,album,explicit,popularity,duration_ms,uri,external_ids,external_urls,track_number,disc_number,preview_url))`;
  while (next) {
    try {
      const data = await safeGet(next.replace('https://api.spotify.com',''));
      (data.items||[]).forEach(item => {
        const t = item && item.track;
        if (!t || !t.id) return;
        tracks.push({
          id: t.id,
          name: t.name,
          artists: t.artists.map(a => a.name),
          artist_ids: t.artists.map(a => a.id),
          album_name: t.album.name,
          album_id: t.album.id,
          album_type: t.album.album_type || '',
          album_total_tracks: t.album.total_tracks || null,
          album_image: getAlbumImage(t.album),
          release_date: t.album.release_date || '',
          year: parseInt((t.album.release_date||'0').slice(0,4)) || null,
          track_number: t.track_number || null,
          disc_number: t.disc_number || null,
          duration_ms: t.duration_ms || null,
          explicit: t.explicit || false,
          popularity: t.popularity != null ? t.popularity : null,
          isrc: (t.external_ids && t.external_ids.isrc) ? t.external_ids.isrc : '',
          preview_url: t.preview_url || '',
          uri: t.uri || '',
          spotify_url: (t.external_urls && t.external_urls.spotify) ? t.external_urls.spotify : '',
          added_at: item.added_at || ''
        });
      });
      next = data.next;
    } catch(e) { break; }
    await sleep(80);
  }
  return tracks;
}

async function fetchArtistData(tracks) {
  const artistMap = {};
  tracks.forEach(t => (t.artist_ids||[]).forEach(id => { artistMap[id] = null; }));
  const ids = Object.keys(artistMap);
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const data = await safeGet(`/v1/artists?ids=${ids.slice(i,i+50).join(',')}`);
      data.artists.forEach(a => { if (a) artistMap[a.id] = { genres: a.genres||[], popularity: a.popularity }; });
    } catch(e) {}
    await sleep(100);
  }
  tracks.forEach(t => {
    const genres = new Set();
    let pop = null;
    (t.artist_ids||[]).forEach(id => {
      const a = artistMap[id];
      if (!a) return;
      a.genres.forEach(g => genres.add(g));
      if (a.popularity != null) pop = Math.max(pop||0, a.popularity);
    });
    t.genres = Array.from(genres);
    t.artist_popularity = pop;
  });
}

async function fetchTopTracks(trackMap) {
  for (const range of ['short_term','medium_term','long_term']) {
    try {
      const data = await safeGet(`/v1/me/top/tracks?limit=50&time_range=${range}`);
      (data.items||[]).forEach((t,i) => {
        if (trackMap[t.id]) {
          const key = range==='short_term' ? 'top_short_rank' : range==='medium_term' ? 'top_medium_rank' : 'top_long_rank';
          trackMap[t.id][key] = i+1;
        }
      });
    } catch(e) {}
    await sleep(200);
  }
}

async function loadLibrary() {
  loadProgress = { status:'loading', message:'fetching liked songs...' };
  try {
    const likedTracks = await fetchAllLikedTracks();
    loadProgress.message = `${likedTracks.length} liked songs. fetching playlists...`;
    const playlists = await fetchAllPlaylists();
    const trackMap = {};
    likedTracks.forEach(t => { trackMap[t.id] = t; });
    for (let i = 0; i < playlists.length; i++) {
      const pl = playlists[i];
      loadProgress.message = `playlist ${i+1}/${playlists.length}: ${pl.name}`;
      const plTracks = await fetchPlaylistTracks(pl.id);
      plTracks.forEach(t => {
        if (!trackMap[t.id]) {
          trackMap[t.id] = { ...t, liked:false, liked_at:'', playlists:[], playlist_added_at:{}, genres:[], artist_popularity:null, top_short_rank:null, top_medium_rank:null, top_long_rank:null };
        }
        if (!trackMap[t.id].playlists.includes(pl.name)) {
          trackMap[t.id].playlists.push(pl.name);
          trackMap[t.id].playlist_added_at[pl.name] = t.added_at||'';
        }
      });
    }
    const tracks = Object.values(trackMap);
    loadProgress.message = `${tracks.length} unique tracks. loading artist data...`;
    await fetchArtistData(tracks);
    loadProgress.message = 'loading your top tracks...';
    await fetchTopTracks(trackMap);
    libraryCache = { tracks, fetched_at: new Date().toISOString() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(libraryCache), 'utf8');
    loadProgress = { status:'done', message:`loaded ${tracks.length} tracks` };
    console.log(`saved cache (${tracks.length} tracks)`);
  } catch(e) {
    loadProgress = { status:'error', message:e.message };
    console.error('load error:', e);
  }
}

async function getUserId() {
  await ensureToken();
  const data = await safeGet('/v1/me');
  return data.id;
}

async function createPlaylist(userId, name, isPublic) {
  return await spotifyApiPost(`/v1/users/${userId}/playlists`, { name, public: isPublic, description: 'Created with Spotify Library Explorer' });
}

async function addTracksToPlaylist(playlistId, uris) {
  const results = [];
  for (let i = 0; i < uris.length; i += 100) {
    const r = await spotifyApiPost(`/v1/playlists/${playlistId}/tracks`, { uris: uris.slice(i, i+100) });
    results.push(r);
    await sleep(200);
  }
  return results;
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      libraryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`loaded cache: ${libraryCache.tracks.length} tracks from ${libraryCache.fetched_at}`);
    }
  } catch(e) { console.error('cache read error:', e.message); }
}

function toCSV(tracks) {
  const headers = ['name','artists','album_name','album_type','release_date','year','track_number','disc_number','duration_ms','explicit','popularity','genres','artist_popularity','isrc','liked','liked_at','playlists','top_short_rank','top_medium_rank','top_long_rank','preview_url','spotify_url','uri'];
  const rows = [headers];
  tracks.forEach(t => rows.push([
    t.name, (t.artists||[]).join('; '), t.album_name, t.album_type||'',
    t.release_date, t.year||'', t.track_number||'', t.disc_number||'',
    t.duration_ms||'', t.explicit?'yes':'no', t.popularity!=null?t.popularity:'',
    (t.genres||[]).join('; '), t.artist_popularity!=null?t.artist_popularity:'',
    t.isrc||'', t.liked?'yes':'no', t.liked_at||'',
    (t.playlists||[]).join('; '),
    t.top_short_rank||'', t.top_medium_rank||'', t.top_long_rank||'',
    t.preview_url||'', t.spotify_url||'', t.uri
  ]));
  return rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
}

loadCache();

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${YOUR_NAME} / spotify library</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --white:#ffffff;--bg:#fafafa;--border:#ebebeb;--border-dark:#d4d4d4;
  --text:#1a1a1a;--text-muted:#8a8a8a;--text-light:#c0c0c0;
  --accent:#4AAED4;--accent-light:#EDF6FC;--accent-dark:#2e8ab8;
  --font:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;
}
body{font-family:var(--font);font-size:13px;background:var(--bg);color:var(--text);height:100vh;overflow:hidden;display:flex;flex-direction:column;}
a{color:var(--accent);text-decoration:none;}a:hover{color:var(--accent-dark);}
button{font-family:var(--font);font-size:12px;padding:5px 12px;border:1px solid var(--border-dark);border-radius:4px;background:var(--white);color:var(--text);cursor:pointer;transition:all 0.12s;white-space:nowrap;}
button:hover{border-color:var(--accent);color:var(--accent);}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
button.primary:hover{background:var(--accent-dark);border-color:var(--accent-dark);}
button:disabled{opacity:0.35;cursor:default;pointer-events:none;}
input,select{font-family:var(--font);font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--white);color:var(--text);outline:none;}
input:focus,select:focus{border-color:var(--accent);}

/* layout */
.header{background:var(--white);border-bottom:1px solid var(--border);padding:11px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0;}
.header-left{font-size:12px;letter-spacing:0.07em;color:var(--text-muted);text-transform:lowercase;}
.header-left span{color:var(--text);}
.header-right{display:flex;gap:8px;align-items:center;}
.fetch-info{font-size:11px;color:var(--text-light);}
.statusbar{background:var(--accent-light);border-bottom:1px solid var(--border);padding:6px 20px;font-size:12px;color:var(--accent-dark);display:none;flex-shrink:0;}
.statusbar.on{display:block;}
.statsbar{background:var(--white);border-bottom:1px solid var(--border);padding:7px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;flex-shrink:0;}
.stat{display:flex;flex-direction:column;gap:1px;}
.stat-n{font-size:15px;font-weight:500;letter-spacing:-0.02em;}
.stat-l{font-size:10px;color:var(--text-muted);text-transform:lowercase;letter-spacing:0.04em;}

/* body layout */
.body{display:flex;flex:1;overflow:hidden;}

/* sidebar */
.sidebar{width:230px;flex-shrink:0;background:var(--white);border-right:1px solid var(--border);overflow-y:auto;padding:12px 14px;font-size:12px;}
.ss{margin-bottom:14px;}
.ss-label{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;}
.ss-label button{font-size:10px;padding:1px 5px;border:none;background:none;color:var(--text-muted);cursor:pointer;letter-spacing:0;}
.ss-label button:hover{color:var(--accent);border:none;}
.range-row{display:flex;align-items:center;gap:5px;margin-bottom:4px;}
.range-row label{font-size:10px;color:var(--text-muted);width:28px;flex-shrink:0;}
.range-row input[type=range]{flex:1;accent-color:var(--accent);}
.range-row span{font-size:11px;min-width:28px;text-align:right;}
.pills{display:flex;flex-wrap:wrap;gap:3px;max-height:80px;overflow-y:auto;margin-top:3px;}
.pill{font-size:10px;padding:2px 7px;border-radius:20px;border:1px solid var(--border);background:var(--white);cursor:pointer;color:var(--text-muted);white-space:nowrap;transition:all 0.1s;}
.pill:hover{border-color:var(--accent);color:var(--accent);}
.pill.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.pill-search{width:100%;margin-bottom:4px;font-size:11px;}
.col-toggles{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}
.ct{font-size:10px;padding:2px 7px;border-radius:3px;border:1px solid var(--border);cursor:pointer;color:var(--text-muted);background:var(--white);}
.ct.on{background:var(--accent-light);border-color:var(--accent);color:var(--accent-dark);}

/* main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.view-tabs{display:flex;border-bottom:1px solid var(--border);background:var(--white);flex-shrink:0;}
.tab-btn{border:none;border-bottom:2px solid transparent;border-radius:0;background:none;color:var(--text-muted);font-size:12px;padding:9px 16px;cursor:pointer;}
.tab-btn:hover{color:var(--text);border-bottom-color:var(--border-dark);}
.tab-btn.on{color:var(--accent);border-bottom-color:var(--accent);}

.sel-bar{background:var(--accent-light);border-bottom:1px solid var(--border);padding:7px 14px;display:none;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;}
.sel-bar.on{display:flex;}
.sel-bar input[type=text]{width:180px;}
#playlistMsg{font-size:11px;color:var(--accent-dark);}

/* table */
.tbl-outer{flex:1;overflow:auto;}
table{border-collapse:collapse;font-size:12px;width:max-content;min-width:100%;}
thead{position:sticky;top:0;z-index:30;}
thead tr{background:var(--white);}
th{padding:0;border-bottom:1px solid var(--border-dark);border-right:1px solid var(--border);position:relative;white-space:nowrap;}
.th-inner{display:flex;align-items:center;gap:3px;padding:7px 10px;cursor:pointer;user-select:none;font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);}
.th-inner:hover{color:var(--accent);}
th.sorted .th-inner{color:var(--accent);}
.th-filter-btn{padding:2px 4px;border:none;background:none;color:var(--text-light);cursor:pointer;font-size:11px;border-radius:2px;flex-shrink:0;}
.th-filter-btn:hover,.th-filter-btn.on{color:var(--accent);background:var(--accent-light);}
.th-filter-btn.active{color:var(--accent-dark);background:var(--accent-light);}

/* column filter popover */
.col-filter-pop{position:absolute;top:100%;left:0;min-width:180px;max-width:240px;background:var(--white);border:1px solid var(--border-dark);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.1);z-index:200;padding:10px;display:none;}
.col-filter-pop.on{display:block;}
.col-filter-pop input[type=text],.col-filter-pop input[type=number]{width:100%;margin-bottom:6px;font-size:12px;}
.cfp-opts{max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;}
.cfp-opt{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:3px 4px;border-radius:3px;}
.cfp-opt:hover{background:var(--accent-light);}
.cfp-opt input[type=checkbox]{accent-color:var(--accent);flex-shrink:0;}
.cfp-actions{display:flex;justify-content:space-between;margin-top:8px;gap:6px;}
.cfp-actions button{font-size:11px;padding:4px 8px;}

/* rows */
tbody tr{border-bottom:1px solid var(--border);transition:background 0.08s;}
tbody tr:hover{background:var(--accent-light);}
tbody tr.sel{background:#e8f4fa;}
td{padding:5px 10px;white-space:nowrap;vertical-align:middle;border-right:1px solid var(--border);max-width:200px;overflow:hidden;text-overflow:ellipsis;}
td.nc{overflow:visible;max-width:none;}
.art{width:30px;height:30px;border-radius:3px;object-fit:cover;display:block;}
.art-ph{width:30px;height:30px;border-radius:3px;background:var(--border);display:block;}
.t-name{font-weight:500;}
.t-artist{color:var(--text-muted);}
.badge-e{font-size:10px;padding:1px 5px;border-radius:10px;background:#fff0f0;color:#cc4444;border:1px solid #ffcccc;}
.rank{font-size:11px;font-weight:500;color:var(--accent-dark);}
.play-btn{width:24px;height:24px;border-radius:50%;border:1px solid var(--border-dark);background:var(--white);cursor:pointer;font-size:9px;display:flex;align-items:center;justify-content:center;padding:0;color:var(--text-muted);}
.play-btn:hover{border-color:var(--accent);color:var(--accent);}
.play-btn.playing{background:var(--accent);border-color:var(--accent);color:#fff;}
.play-btn.np{opacity:0.2;cursor:default;pointer-events:none;}
.cb{width:13px;height:13px;cursor:pointer;accent-color:var(--accent);}
.empty-msg{padding:50px;text-align:center;color:var(--text-muted);}

/* by-year view */
.yr-section{margin-bottom:24px;}
.yr-head{font-size:11px;padding:8px 14px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg);z-index:5;display:flex;align-items:center;gap:10px;}
.yr-head strong{font-size:13px;font-weight:500;}
.yr-head span{color:var(--text-muted);}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">${YOUR_NAME} / <span>spotify library</span></div>
  <div class="header-right">
    <span class="fetch-info" id="fetchInfo"></span>
    <button onclick="connectSpotify()">connect spotify</button>
    <button id="fetchBtn" onclick="triggerLoad()" disabled>fetch library</button>
    <button onclick="exportCSV()">export csv</button>
  </div>
</div>

<div class="statusbar" id="statusbar"></div>

<div class="statsbar">
  <div class="stat"><div class="stat-n" id="s-total">—</div><div class="stat-l">total</div></div>
  <div class="stat"><div class="stat-n" id="s-shown">—</div><div class="stat-l">showing</div></div>
  <div class="stat"><div class="stat-n" id="s-sel">0</div><div class="stat-l">selected</div></div>
  <div class="stat"><div class="stat-n" id="s-liked">—</div><div class="stat-l">liked</div></div>
  <div class="stat"><div class="stat-n" id="s-pls">—</div><div class="stat-l">playlists</div></div>
  <div class="stat"><div class="stat-n" id="s-genres">—</div><div class="stat-l">genres</div></div>
  <div class="stat"><div class="stat-n" id="s-artists">—</div><div class="stat-l">artists</div></div>
</div>

<div class="body">

  <div class="sidebar">

    <div class="ss">
      <div class="ss-label">search</div>
      <input style="width:100%;" type="search" id="sb-search" placeholder="track, artist, album..." oninput="applyFiltersDebounced()" />
    </div>

    <div class="ss">
      <div class="ss-label">source</div>
      <select style="width:100%;" id="sb-source" onchange="applyFilters()">
        <option value="all">all sources</option>
        <option value="liked">liked songs only</option>
        <option value="playlist">in playlists only</option>
      </select>
    </div>

    <div class="ss">
      <div class="ss-label">explicit</div>
      <select style="width:100%;" id="sb-explicit" onchange="applyFilters()">
        <option value="all">all</option>
        <option value="yes">explicit only</option>
        <option value="no">clean only</option>
      </select>
    </div>

    <div class="ss">
      <div class="ss-label">top tracks</div>
      <select style="width:100%;" id="sb-top" onchange="applyFilters()">
        <option value="all">all</option>
        <option value="any">any top list</option>
        <option value="short">last 4 weeks</option>
        <option value="medium">last 6 months</option>
        <option value="long">all time</option>
      </select>
    </div>

    <div class="ss">
      <div class="ss-label">album type</div>
      <select style="width:100%;" id="sb-albumtype" onchange="applyFilters()">
        <option value="all">all</option>
        <option value="album">album</option>
        <option value="single">single</option>
        <option value="compilation">compilation</option>
      </select>
    </div>

    <div class="ss">
      <div class="ss-label">release year</div>
      <div class="range-row"><label>from</label><input type="range" id="sb-yfrom" min="1950" max="2026" value="1950" step="1" oninput="syncRange('yfrom')" /><span id="v-yfrom">1950</span></div>
      <div class="range-row"><label>to</label><input type="range" id="sb-yto" min="1950" max="2026" value="2026" step="1" oninput="syncRange('yto')" /><span id="v-yto">2026</span></div>
    </div>

    <div class="ss">
      <div class="ss-label">popularity min</div>
      <div class="range-row"><label>min</label><input type="range" id="sb-popmin" min="0" max="100" value="0" step="1" oninput="syncRange('popmin')" /><span id="v-popmin">0</span></div>
    </div>

    <div class="ss">
      <div class="ss-label">playlists <span id="pl-count"></span><button onclick="clearPillSet('pl')">clear</button></div>
      <input class="pill-search" type="search" id="pl-search" placeholder="filter..." oninput="renderPills('pl')" />
      <div class="pills" id="pl-pills"></div>
    </div>

    <div class="ss">
      <div class="ss-label">genres <span id="g-count"></span><button onclick="clearPillSet('g')">clear</button></div>
      <input class="pill-search" type="search" id="g-search" placeholder="filter..." oninput="renderPills('g')" />
      <div class="pills" id="g-pills"></div>
    </div>

    <div class="ss">
      <div class="ss-label">columns</div>
      <div class="col-toggles" id="col-toggles"></div>
    </div>

    <button style="width:100%;margin-top:4px;" onclick="resetAll()">reset all filters</button>
  </div>

  <div class="main">
    <div class="view-tabs">
      <button class="tab-btn on" id="tab-lib" onclick="setView('lib')">library</button>
      <button class="tab-btn" id="tab-yr" onclick="setView('yr')">by year added</button>
    </div>

    <div class="sel-bar" id="sel-bar">
      <span id="sel-count" style="font-size:12px;color:var(--text-muted);white-space:nowrap;"></span>
      <button onclick="selectAllVisible()" style="font-size:11px;padding:4px 9px;">select all visible</button>
      <input type="text" id="pl-name" placeholder="playlist name..." />
      <select id="pl-public" style="width:90px;">
        <option value="false">private</option>
        <option value="true">public</option>
      </select>
      <button class="primary" onclick="savePlaylist()">save to spotify</button>
      <button onclick="clearSelection()">clear</button>
      <span id="playlistMsg"></span>
    </div>

    <div class="tbl-outer" id="tbl-lib">
      <div class="empty-msg" id="empty-msg">connect spotify and fetch your library to get started</div>
      <table id="main-table" style="display:none;">
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <div class="tbl-outer" id="tbl-yr" style="display:none;"></div>
  </div>
</div>

<audio id="audio"></audio>

<script>
//  Column definitions 
const COLS = [
  { key:'sel',      label:'',          tip:'select for playlist',           always:true,  def:true,  filter:null },
  { key:'art',      label:'',          tip:'album artwork',                  always:true,  def:true,  filter:null },
  { key:'play',     label:'',          tip:'30-second preview',              always:true,  def:true,  filter:null },
  { key:'name',     label:'track',     tip:'the song title',                 always:true,  def:true,  filter:'text' },
  { key:'artists',  label:'artist',    tip:'who performed the track',        always:true,  def:true,  filter:'text' },
  { key:'genres',   label:'genres',    tip:'genres from the artist(s)',      always:false, def:true,  filter:'multi' },
  { key:'year',     label:'year',      tip:'year the album was released',    always:false, def:true,  filter:'multi' },
  { key:'album_type',label:'type',     tip:'album, single, or compilation',  always:false, def:true,  filter:'multi' },
  { key:'album',    label:'album',     tip:'the album this track is on',     always:false, def:true,  filter:'text' },
  { key:'explicit', label:'E',         tip:'contains explicit content',      always:false, def:true,  filter:'multi' },
  { key:'pop',      label:'pop',       tip:'spotify popularity right now (0–100)', always:false, def:true, filter:'range' },
  { key:'artist_pop',label:'art. pop', tip:'artist popularity right now (0–100)', always:false, def:false, filter:'range' },
  { key:'liked',    label:'♥',         tip:'in your liked songs',            always:false, def:true,  filter:'multi' },
  { key:'liked_at', label:'liked on',  tip:'date you liked this track',      always:false, def:false, filter:'multi' },
  { key:'playlists',label:'playlists', tip:'which of your playlists this appears in', always:false, def:true, filter:'multi' },
  { key:'top_s',    label:'top 4wk',   tip:'your listening rank in the last 4 weeks (top 50)', always:false, def:true, filter:'range' },
  { key:'top_m',    label:'top 6mo',   tip:'your listening rank in the last 6 months (top 50)', always:false, def:true, filter:'range' },
  { key:'top_l',    label:'top all',   tip:'your all-time listening rank (top 50)', always:false, def:true, filter:'range' },
  { key:'dur',      label:'duration',  tip:'how long the track is',          always:false, def:false, filter:null },
  { key:'track_n',  label:'track #',   tip:'track number on the album',      always:false, def:false, filter:null },
  { key:'isrc',     label:'isrc',      tip:'international standard recording code — a unique ID for this recording', always:false, def:false, filter:'text' },
  { key:'open',     label:'open',      tip:'open in spotify app',            always:false, def:true,  filter:null },
];

//  State
let tracks = [];
let filtered = [];
let selected = new Set();
let activePL = new Set();
let activeG = new Set();
let sortCol = 'pop';
let sortDir = -1;
let visCols = new Set(COLS.filter(c => c.always || c.def).map(c => c.key));
let currentView = 'lib';
let lastClickIdx = null;
let openPopKey = null;
let theadDirty = true;

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
const applyFiltersDebounced = debounce(()=>applyFilters(), 180);

// Column filters -- each key maps to filter state depending on type
// text: { q: '' }
// multi: { vals: Set }
// range: { min: null, max: null }
const colFilters = {};
COLS.forEach(c => {
  if (c.filter === 'text') colFilters[c.key] = { q: '' };
  else if (c.filter === 'multi') colFilters[c.key] = { vals: new Set() };
  else if (c.filter === 'range') colFilters[c.key] = { min: null, max: null };
});

// Pill data
let plData = {}, gData = {};

// Audio
const audio = document.getElementById('audio');
let curUrl = null, curBtn = null;
audio.addEventListener('ended', () => { if(curBtn){curBtn.textContent='▶';curBtn.classList.remove('playing');} curUrl=null;curBtn=null; });

//  Helpers 
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function dur(ms){ if(!ms)return'—'; const m=Math.floor(ms/60000),s=Math.round((ms%60000)/1000); return m+':'+(s<10?'0':'')+s; }
function trackVal(t, key) {
  switch(key){
    case 'name': return t.name;
    case 'artists': return (t.artists||[]).join(', ');
    case 'genres': return (t.genres||[]).join(', ');
    case 'year': return t.year;
    case 'album_type': return t.album_type;
    case 'album': return t.album_name;
    case 'explicit': return t.explicit?1:0;
    case 'pop': return t.popularity;
    case 'artist_pop': return t.artist_popularity;
    case 'liked': return t.liked?1:0;
    case 'liked_at': return t.liked_at;
    case 'playlists': return (t.playlists||[]).join(', ');
    case 'top_s': return t.top_short_rank;
    case 'top_m': return t.top_medium_rank;
    case 'top_l': return t.top_long_rank;
    case 'dur': return t.duration_ms;
    case 'track_n': return t.track_number;
    default: return null;
  }
}

function setStatus(msg, show=true){ const el=document.getElementById('statusbar'); el.textContent=msg; el.classList.toggle('on',show); }

//  Auth & load 
function connectSpotify(){ window.location.href='/auth'; }

async function triggerLoad(){
  document.getElementById('fetchBtn').disabled=true;
  setStatus('starting fetch...');
  await fetch('/load');
  const poll = setInterval(async()=>{
    const d=await(await fetch('/progress')).json();
    setStatus(d.message);
    if(d.status==='done'){ clearInterval(poll); await initLibrary(); }
    else if(d.status==='error'){ clearInterval(poll); setStatus('error: '+d.message); document.getElementById('fetchBtn').disabled=false; }
  },1500);
}

async function initLibrary(){
  const data = await(await fetch('/tracks')).json();
  tracks = data.tracks||[];
  const fa = data.fetched_at ? new Date(data.fetched_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  document.getElementById('fetchInfo').textContent = fa ? 'fetched '+fa : '';
  document.getElementById('fetchBtn').disabled=false;
  buildPillData();
  buildColToggles();
  updateHeaderStats();
  applyFilters();
  setStatus('',false);
  document.getElementById('main-table').style.display='table';
  document.getElementById('empty-msg').style.display='none';
}

function updateHeaderStats(){
  document.getElementById('s-total').textContent=tracks.length;
  document.getElementById('s-liked').textContent=tracks.filter(t=>t.liked).length;
  const arts=new Set(); tracks.forEach(t=>(t.artists||[]).forEach(a=>arts.add(a)));
  document.getElementById('s-artists').textContent=arts.size;
  document.getElementById('s-pls').textContent=Object.keys(plData).length;
  document.getElementById('s-genres').textContent=Object.keys(gData).length;
}

//  Pills 
function buildPillData(){
  plData={}; gData={};
  tracks.forEach(t=>{
    (t.playlists||[]).forEach(p=>{ plData[p]=(plData[p]||0)+1; });
    (t.genres||[]).forEach(g=>{ gData[g]=(gData[g]||0)+1; });
  });
  renderPills('pl'); renderPills('g');
}

function renderPills(type){
  const data=type==='pl'?plData:gData;
  const activeSet=type==='pl'?activePL:activeG;
  const q=(document.getElementById(type+'-search').value||'').toLowerCase();
  const wrap=document.getElementById(type+'-pills');
  wrap.innerHTML='';
  Object.entries(data)
    .filter(([k])=>!q||k.toLowerCase().includes(q))
    .sort((a,b)=>b[1]-a[1])
    .forEach(([k,c])=>{
      const p=document.createElement('span');
      p.className='pill'+(activeSet.has(k)?' on':'');
      p.textContent=k+' ('+c+')';
      p.onclick=()=>{
        activeSet.has(k)?activeSet.delete(k):activeSet.add(k);
        p.classList.toggle('on',activeSet.has(k));
        document.getElementById(type+'-count').textContent=activeSet.size>0?'('+activeSet.size+')':'';
        // sync to column filter
        if(type==='pl' && colFilters['playlists']) { colFilters['playlists'].vals=new Set(activePL); }
        if(type==='g' && colFilters['genres']) { colFilters['genres'].vals=new Set(activeG); }
        applyFilters();
      };
      wrap.appendChild(p);
    });
}

function clearPillSet(type){
  if(type==='pl'){ activePL.clear(); colFilters['playlists'].vals=new Set(); document.getElementById('pl-count').textContent=''; }
  else { activeG.clear(); colFilters['genres'].vals=new Set(); document.getElementById('g-count').textContent=''; }
  renderPills(type); applyFilters();
}

//  Column toggles 
function buildColToggles(){
  const wrap=document.getElementById('col-toggles'); wrap.innerHTML='';
  COLS.filter(c=>!c.always).forEach(c=>{
    const b=document.createElement('span');
    b.className='ct'+(visCols.has(c.key)?' on':'');
    b.textContent=c.label||c.key;
    b.onclick=()=>{ visCols.has(c.key)?visCols.delete(c.key):visCols.add(c.key); b.classList.toggle('on'); theadDirty=true; renderTable(); };
    wrap.appendChild(b);
  });
}

//  Range sync 
function syncRange(id){
  const v=document.getElementById('sb-'+id).value;
  document.getElementById('v-'+id).textContent=v;
  applyFilters();
}

//  Filtering 
function applyFilters(){
  const s=document.getElementById('sb-search').value.toLowerCase();
  const src=document.getElementById('sb-source').value;
  const exp=document.getElementById('sb-explicit').value;
  const top=document.getElementById('sb-top').value;
  const yf=parseInt(document.getElementById('sb-yfrom').value);
  const yt=parseInt(document.getElementById('sb-yto').value);
  const popMin=parseInt(document.getElementById('sb-popmin').value);
  const albumType=document.getElementById('sb-albumtype').value;

  filtered=tracks.filter(t=>{
    // sidebar filters
    if(s){ const h=(t.name+' '+(t.artists||[]).join(' ')+' '+(t.album_name||'')).toLowerCase(); if(!h.includes(s))return false; }
    if(src==='liked'&&!t.liked)return false;
    if(src==='playlist'&&!(t.playlists&&t.playlists.length>0))return false;
    if(exp==='yes'&&!t.explicit)return false;
    if(exp==='no'&&t.explicit)return false;
    if(top==='any'&&!t.top_short_rank&&!t.top_medium_rank&&!t.top_long_rank)return false;
    if(top==='short'&&!t.top_short_rank)return false;
    if(top==='medium'&&!t.top_medium_rank)return false;
    if(top==='long'&&!t.top_long_rank)return false;
    if(t.year&&(t.year<yf||t.year>yt))return false;
    if(t.popularity!=null&&t.popularity<popMin)return false;
    if(albumType!=='all'&&t.album_type!==albumType)return false;
    if(activePL.size>0&&!(t.playlists||[]).some(p=>activePL.has(p)))return false;
    if(activeG.size>0&&!(t.genres||[]).some(g=>activeG.has(g)))return false;

    // column filters
    for(const c of COLS){
      const cf=colFilters[c.key];
      if(!cf)continue;
      if(c.filter==='text'&&cf.q){
        const v=String(trackVal(t,c.key)||'').toLowerCase();
        if(!v.includes(cf.q.toLowerCase()))return false;
      } else if(c.filter==='multi'&&cf.vals.size>0){
        const v=trackVal(t,c.key);
        // for array-valued fields (genres, playlists)
        if(Array.isArray(t[c.key==='genres'?'genres':c.key==='playlists'?'playlists':null])){
          const arr=t[c.key==='genres'?'genres':'playlists'];
          if(!arr.some(x=>cf.vals.has(String(x))))return false;
        } else {
          if(!cf.vals.has(String(v)))return false;
        }
      } else if(c.filter==='range'){
        const v=trackVal(t,c.key);
        if(cf.min!=null&&(v==null||v<cf.min))return false;
        if(cf.max!=null&&(v==null||v>cf.max))return false;
      }
    }
    return true;
  });

  sortData();
  document.getElementById('s-shown').textContent=filtered.length;
  renderTable();
}

function sortData(){
  filtered.sort((a,b)=>{
    let av=trackVal(a,sortCol),bv=trackVal(b,sortCol);
    if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1;
    if(typeof av==='string')return sortDir*av.localeCompare(bv);
    return sortDir*(av-bv);
  });
}

//  Column filter popover 
function getUniqueVals(key){
  const vals=new Set();
  tracks.forEach(t=>{
    const c=COLS.find(c=>c.key===key);
    if(!c)return;
    if(key==='genres')(t.genres||[]).forEach(g=>vals.add(String(g)));
    else if(key==='playlists')(t.playlists||[]).forEach(p=>vals.add(String(p)));
    else { const v=trackVal(t,key); if(v!=null&&v!=='')vals.add(String(v)); }
  });
  return Array.from(vals).sort((a,b)=>isNaN(a)?a.localeCompare(b):Number(a)-Number(b));
}

function openColFilter(key, thEl){
  // close any open popover
  if(openPopKey && openPopKey!==key){
    const prev=document.getElementById('cfp-'+openPopKey);
    if(prev)prev.classList.remove('on');
  }
  const pop=document.getElementById('cfp-'+key);
  if(!pop)return;
  const isOpen=pop.classList.contains('on');
  pop.classList.toggle('on',!isOpen);
  openPopKey=!isOpen?key:null;
  if(!isOpen) buildPopContent(key, pop);
}

function buildPopContent(key, pop){
  const col=COLS.find(c=>c.key===key);
  if(!col)return;
  const cf=colFilters[key];
  pop.innerHTML='';

  if(col.filter==='text'){
    const inp=document.createElement('input');
    inp.type='text'; inp.placeholder='search...'; inp.value=cf.q||'';
    inp.oninput=()=>{ cf.q=inp.value; applyFilters(); };
    pop.appendChild(inp);
    const actions=document.createElement('div'); actions.className='cfp-actions';
    const clear=document.createElement('button'); clear.textContent='clear';
    clear.onclick=()=>{ cf.q=''; inp.value=''; applyFilters(); };
    actions.appendChild(clear); pop.appendChild(actions);

  } else if(col.filter==='multi'){
    const search=document.createElement('input');
    search.type='text'; search.placeholder='search...'; search.className='cfp-search';
    const opts=document.createElement('div'); opts.className='cfp-opts';
    const vals=getUniqueVals(key);
    const renderOpts=(q)=>{
      opts.innerHTML='';
      vals.filter(v=>!q||v.toLowerCase().includes(q.toLowerCase())).forEach(v=>{
        const row=document.createElement('label'); row.className='cfp-opt';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=cf.vals.has(v);
        cb.onchange=()=>{
          cb.checked?cf.vals.add(v):cf.vals.delete(v);
          // sync back to sidebar pills
          if(key==='playlists'){ activePL=new Set(cf.vals); renderPills('pl'); document.getElementById('pl-count').textContent=activePL.size>0?'('+activePL.size+')':''; }
          if(key==='genres'){ activeG=new Set(cf.vals); renderPills('g'); document.getElementById('g-count').textContent=activeG.size>0?'('+activeG.size+')':''; }
          applyFilters();
        };
        row.appendChild(cb);
        const lbl=document.createElement('span'); lbl.textContent=v; row.appendChild(lbl);
        opts.appendChild(row);
      });
    };
    renderOpts('');
    search.oninput=()=>renderOpts(search.value);
    pop.appendChild(search); pop.appendChild(opts);
    const actions=document.createElement('div'); actions.className='cfp-actions';
    const selAll=document.createElement('button'); selAll.textContent='select all';
    selAll.onclick=()=>{ vals.forEach(v=>cf.vals.add(v)); if(key==='playlists'){activePL=new Set(cf.vals);renderPills('pl');} if(key==='genres'){activeG=new Set(cf.vals);renderPills('g');} buildPopContent(key,pop); applyFilters(); };
    const clear=document.createElement('button'); clear.textContent='clear';
    clear.onclick=()=>{ cf.vals.clear(); if(key==='playlists'){activePL.clear();renderPills('pl');document.getElementById('pl-count').textContent='';} if(key==='genres'){activeG.clear();renderPills('g');document.getElementById('g-count').textContent='';} buildPopContent(key,pop); applyFilters(); };
    actions.appendChild(selAll); actions.appendChild(clear); pop.appendChild(actions);

  } else if(col.filter==='range'){
    const vals=tracks.map(t=>trackVal(t,key)).filter(v=>v!=null);
    const mn=Math.min(...vals), mx=Math.max(...vals);
    const minRow=document.createElement('div'); minRow.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const minLabel=document.createElement('span'); minLabel.textContent='min'; minLabel.style.cssText='font-size:11px;color:var(--text-muted);width:24px;';
    const minInp=document.createElement('input'); minInp.type='number'; minInp.style.width='80px'; minInp.placeholder=mn; minInp.value=cf.min!=null?cf.min:'';
    minInp.oninput=()=>{ cf.min=minInp.value!==''?Number(minInp.value):null; applyFilters(); };
    minRow.appendChild(minLabel); minRow.appendChild(minInp);
    const maxRow=document.createElement('div'); maxRow.style.cssText='display:flex;align-items:center;gap:6px;';
    const maxLabel=document.createElement('span'); maxLabel.textContent='max'; maxLabel.style.cssText='font-size:11px;color:var(--text-muted);width:24px;';
    const maxInp=document.createElement('input'); maxInp.type='number'; maxInp.style.width='80px'; maxInp.placeholder=mx; maxInp.value=cf.max!=null?cf.max:'';
    maxInp.oninput=()=>{ cf.max=maxInp.value!==''?Number(maxInp.value):null; applyFilters(); };
    maxRow.appendChild(maxLabel); maxRow.appendChild(maxInp);
    pop.appendChild(minRow); pop.appendChild(maxRow);
    const actions=document.createElement('div'); actions.className='cfp-actions';
    const clear=document.createElement('button'); clear.textContent='clear';
    clear.onclick=()=>{ cf.min=null; cf.max=null; minInp.value=''; maxInp.value=''; applyFilters(); };
    actions.appendChild(clear); pop.appendChild(actions);
  }
}

// close popovers when clicking outside
document.addEventListener('click', e=>{
  if(openPopKey && !e.target.closest('.col-filter-pop') && !e.target.closest('.th-filter-btn')){
    const pop=document.getElementById('cfp-'+openPopKey);
    if(pop)pop.classList.remove('on');
    openPopKey=null;
  }
});

function colFilterActive(key){
  const cf=colFilters[key]; if(!cf)return false;
  if(colFilters[key]&&'q' in cf)return!!cf.q;
  if(cf.vals)return cf.vals.size>0;
  if('min' in cf)return cf.min!=null||cf.max!=null;
  return false;
}

//  Table render
function renderTable(){
  const vis=COLS.filter(c=>c.always||visCols.has(c.key));
  const sortable=new Set(['name','artists','genres','year','album_type','album','explicit','pop','artist_pop','liked','liked_at','playlists','top_s','top_m','top_l','dur','track_n','isrc']);

  if(theadDirty){
    theadDirty=false;
    document.getElementById('thead').innerHTML='<tr>'+vis.map(c=>{
      const sa=sortable.has(c.key);
      const isSorted=sortCol===c.key;
      const arrow=isSorted?(sortDir===1?'↑':'↓'):(sa?'<span style="opacity:0.3;">↕</span>':'');
      const hasFil=c.filter&&colFilterActive(c.key);
      const filterBtn=c.filter?'<button class="th-filter-btn'+(hasFil?' active':'')+'" data-cfkey="'+c.key+'" title="filter">▾</button>':'';
      const pop=c.filter?'<div class="col-filter-pop" id="cfp-'+c.key+'"></div>':'';
      return '<th class="'+(isSorted?'sorted':'')+'">'
        +'<div class="th-inner"'+(sa?' data-sortkey="'+c.key+'"':'')+'>'
        +esc(c.label)+(arrow?'<span>'+arrow+'</span>':'')
        +'<span style="position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);background:var(--text);color:#fff;font-size:11px;padding:4px 8px;border-radius:4px;white-space:normal;width:160px;text-align:center;line-height:1.4;pointer-events:none;opacity:0;transition:opacity 0.12s;z-index:400;text-transform:none;letter-spacing:0;font-weight:400;" class="col-tip">'+esc(c.tip)+'</span>'
        +'</div>'
        +filterBtn+pop+'</th>';
    }).join('')+'</tr>';

    const thead=document.getElementById('thead');
    thead.addEventListener('click', e => {
      const filterBtn = e.target.closest('.th-filter-btn');
      const sortEl = e.target.closest('.th-inner[data-sortkey]');
      if (filterBtn) {
        e.stopPropagation();
        openColFilter(filterBtn.dataset.cfkey, filterBtn.closest('th'));
      } else if (sortEl && !e.target.closest('.th-filter-btn')) {
        setSort(sortEl.dataset.sortkey);
      }
    });
    thead.querySelectorAll('.th-inner').forEach(el=>{
      el.addEventListener('mouseenter',()=>{ const t=el.querySelector('.col-tip'); if(t)t.style.opacity='1'; });
      el.addEventListener('mouseleave',()=>{ const t=el.querySelector('.col-tip'); if(t)t.style.opacity='0'; });
    });
  }

  const display=filtered.slice(0,500);
  const tbody=document.getElementById('tbody');
  if(!display.length){ tbody.innerHTML='<tr><td colspan="'+vis.length+'" class="empty-msg">no tracks match your filters</td></tr>'; return; }

  tbody.innerHTML=display.map((t,rowIdx)=>{
    const sel=selected.has(t.id);
    return '<tr class="'+(sel?'sel':'')+'" data-idx="'+rowIdx+'">'
      +vis.map(c=>{
        switch(c.key){
          case 'sel': return '<td class="nc" style="width:30px;text-align:center;"><input class="cb" type="checkbox" '+(sel?'checked':'')+' onchange="toggleSel(\\''+esc(t.id)+'\\',this,'+rowIdx+')" /></td>';
          case 'art': return '<td class="nc" style="width:38px;">'+(t.album_image?'<img class="art" src="'+esc(t.album_image)+'" loading="lazy" alt="" />':'<span class="art-ph"></span>')+'</td>';
          case 'play': return '<td class="nc" style="width:34px;"><button class="play-btn'+(t.preview_url?'':' np')+'" onclick="togglePlay(this,\\''+esc(t.preview_url||'')+'\\')" title="'+(t.preview_url?'play preview':'no preview')+'">▶</button></td>';
          case 'name': return '<td class="t-name" style="max-width:220px;">'+esc(t.name)+'</td>';
          case 'artists': return '<td class="t-artist" style="max-width:160px;">'+esc((t.artists||[]).join(', '))+'</td>';
          case 'genres': return '<td style="max-width:160px;color:var(--text-muted);font-size:11px;">'+esc((t.genres||[]).slice(0,3).join(', ')||'—')+'</td>';
          case 'year': return '<td style="color:var(--text-muted);">'+(t.year||'—')+'</td>';
          case 'album_type': return '<td style="font-size:10px;color:var(--text-muted);">'+esc(t.album_type||'—')+'</td>';
          case 'album': return '<td style="max-width:160px;color:var(--text-muted);">'+esc(t.album_name||'—')+'</td>';
          case 'explicit': return '<td style="width:26px;">'+(t.explicit?'<span class="badge-e">E</span>':'')+'</td>';
          case 'pop': return '<td>'+(t.popularity!=null?t.popularity:'—')+'</td>';
          case 'artist_pop': return '<td>'+(t.artist_popularity!=null?t.artist_popularity:'—')+'</td>';
          case 'liked': return '<td style="width:26px;text-align:center;">'+(t.liked?'<span style="color:#2a8a4a;">♥</span>':'')+'</td>';
          case 'liked_at': return '<td style="color:var(--text-muted);">'+(t.liked_at?t.liked_at.slice(0,10):'—')+'</td>';
          case 'playlists': return '<td style="max-width:180px;font-size:11px;color:var(--text-muted);">'+esc((t.playlists||[]).join(', ')||'—')+'</td>';
          case 'top_s': return '<td>'+(t.top_short_rank?'<span class="rank">#'+t.top_short_rank+'</span>':'')+'</td>';
          case 'top_m': return '<td>'+(t.top_medium_rank?'<span class="rank">#'+t.top_medium_rank+'</span>':'')+'</td>';
          case 'top_l': return '<td>'+(t.top_long_rank?'<span class="rank">#'+t.top_long_rank+'</span>':'')+'</td>';
          case 'dur': return '<td style="color:var(--text-muted);">'+dur(t.duration_ms)+'</td>';
          case 'track_n': return '<td style="color:var(--text-muted);">'+(t.track_number||'—')+'</td>';
          case 'isrc': return '<td style="font-size:10px;color:var(--text-muted);">'+esc(t.isrc||'—')+'</td>';
          case 'open': return '<td style="width:38px;">'+(t.uri?'<a href="'+esc(t.uri)+'" style="font-size:10px;">open ↗</a>':'')+'</td>';
          default: return '<td>—</td>';
        }
      }).join('')+'</tr>';
  }).join('');

  if(filtered.length>500){
    tbody.innerHTML+='<tr><td colspan="'+vis.length+'" style="padding:10px;text-align:center;color:var(--text-muted);font-size:11px;">showing 500 of '+filtered.length+' — use filters to narrow down</td></tr>';
  }
}

function setSort(key){ if(sortCol===key)sortDir*=-1; else{sortCol=key;sortDir=-1;} theadDirty=true; sortData();renderTable(); }

//  Selection 
function toggleSel(id, cb, rowIdx){
  const isShift = window._lastShiftClick && window.event && window.event.shiftKey;
  if(isShift && lastClickIdx!=null){
    const lo=Math.min(lastClickIdx,rowIdx), hi=Math.max(lastClickIdx,rowIdx);
    const addOrRemove=!selected.has(id);
    filtered.slice(lo,hi+1).forEach(t=>{ addOrRemove?selected.add(t.id):selected.delete(t.id); });
  } else {
    selected.has(id)?selected.delete(id):selected.add(id);
  }
  lastClickIdx=rowIdx;
  window._lastShiftClick=true;
  renderTable();
  updateSelBar();
}

// Detect shift key globally
document.addEventListener('keydown',e=>{ if(e.shiftKey)window._shiftDown=true; });
document.addEventListener('keyup',e=>{ window._shiftDown=false; window._lastShiftClick=false; });

// Override toggleSel to use shift state properly
function toggleSel(id, cb, rowIdx){
  if(window._shiftDown && lastClickIdx!=null){
    const lo=Math.min(lastClickIdx,rowIdx), hi=Math.max(lastClickIdx,rowIdx);
    const shouldAdd=!selected.has(id);
    filtered.slice(lo,hi+1).forEach(t=>{ shouldAdd?selected.add(t.id):selected.delete(t.id); });
  } else {
    selected.has(id)?selected.delete(id):selected.add(id);
    lastClickIdx=rowIdx;
  }
  renderTable();
  updateSelBar();
}

function selectAllVisible(){ filtered.slice(0,500).forEach(t=>selected.add(t.id)); renderTable(); updateSelBar(); }
function clearSelection(){ selected.clear(); renderTable(); updateSelBar(); }
function updateSelBar(){
  const n=selected.size;
  document.getElementById('s-sel').textContent=n;
  document.getElementById('sel-bar').classList.toggle('on',n>0);
  document.getElementById('sel-count').textContent=n+' track'+(n!==1?'s':'')+' selected';
}

//  Preview 
function togglePlay(btn,url){
  if(!url)return;
  if(curBtn&&curBtn!==btn){curBtn.textContent='▶';curBtn.classList.remove('playing');}
  if(curUrl===url&&!audio.paused){audio.pause();btn.textContent='▶';btn.classList.remove('playing');curUrl=null;curBtn=null;}
  else{audio.src=url;audio.play();btn.textContent='■';btn.classList.add('playing');curUrl=url;curBtn=btn;}
}

//  By year view 
function setView(v){
  currentView=v;
  document.getElementById('tab-lib').classList.toggle('on',v==='lib');
  document.getElementById('tab-yr').classList.toggle('on',v==='yr');
  document.getElementById('tbl-lib').style.display=v==='lib'?'block':'none';
  document.getElementById('tbl-yr').style.display=v==='yr'?'block':'none';
  if(v==='yr')renderByYear();
}

function renderByYear(){
  const el=document.getElementById('tbl-yr');
  if(!tracks.length){el.innerHTML='<div class="empty-msg">no data</div>';return;}
  const byYear={};
  tracks.forEach(t=>{
    const d=t.liked_at||(t.playlist_added_at&&Object.values(t.playlist_added_at)[0])||'';
    const yr=d?parseInt(d.slice(0,4)):null;
    if(!yr)return;
    if(!byYear[yr])byYear[yr]=[];
    byYear[yr].push(t);
  });
  const years=Object.keys(byYear).map(Number).sort((a,b)=>b-a);
  if(!years.length){el.innerHTML='<div class="empty-msg">no dated tracks found</div>';return;}
  el.innerHTML=years.map(yr=>{
    const yts=byYear[yr].sort((a,b)=>{
      const ar=Math.min(a.top_short_rank||999,a.top_medium_rank||999,a.top_long_rank||999);
      const br=Math.min(b.top_short_rank||999,b.top_medium_rank||999,b.top_long_rank||999);
      if(ar!==br)return ar-br;
      return(b.popularity||0)-(a.popularity||0);
    }).slice(0,20);
    const ranked=byYear[yr].filter(t=>t.top_short_rank||t.top_medium_rank||t.top_long_rank).length;
    const rows=yts.map(t=>{
      const best=[t.top_short_rank,t.top_medium_rank,t.top_long_rank].filter(Boolean).sort((a,b)=>a-b)[0];
      const sel=selected.has(t.id);
      return '<tr class="'+(sel?'sel':'')+'" style="border-bottom:1px solid var(--border);">'
        +'<td style="width:30px;text-align:center;padding:5px 8px;"><input class="cb" type="checkbox" '+(sel?'checked':'')+' onchange="toggleSelById(\\''+esc(t.id)+'\\',this)" /></td>'
        +'<td style="width:38px;padding:5px 8px;">'+(t.album_image?'<img class="art" src="'+esc(t.album_image)+'" loading="lazy" alt="" />':'<span class="art-ph"></span>')+'</td>'
        +'<td style="padding:5px 12px;"><div style="font-weight:500;font-size:12px;">'+esc(t.name)+'</div><div style="font-size:11px;color:var(--text-muted);">'+esc((t.artists||[]).join(', '))+'</div></td>'
        +'<td style="padding:5px 12px;font-size:11px;color:var(--text-muted);">'+esc((t.genres||[]).slice(0,2).join(', ')||'—')+'</td>'
        +'<td style="padding:5px 12px;font-size:11px;">'+(best?'<span class="rank">#'+best+'</span>':(t.popularity!=null?'<span style="color:var(--text-muted);">pop '+t.popularity+'</span>':''))+'</td>'
        +'<td style="padding:5px 10px;">'+(t.preview_url?'<button class="play-btn" onclick="togglePlay(this,\\''+esc(t.preview_url)+'\\')">▶</button>':'<button class="play-btn np">▶</button>')+'</td>'
        +'<td style="padding:5px 10px;">'+(t.uri?'<a href="'+esc(t.uri)+'" style="font-size:10px;">open ↗</a>':'')+'</td>'
        +'</tr>';
    }).join('');
    return '<div class="yr-section"><div class="yr-head"><strong>'+yr+'</strong><span>'+byYear[yr].length+' track'+(byYear[yr].length!==1?'s':'')+' added'+(ranked?' · '+ranked+' in your top lists':'')+'</span></div>'
      +'<table style="width:100%;border-collapse:collapse;"><tbody>'+rows+'</tbody></table></div>';
  }).join('');
}

function toggleSelById(id,cb){
  selected.has(id)?selected.delete(id):selected.add(id);
  cb.checked=selected.has(id);
  cb.closest('tr').classList.toggle('sel',selected.has(id));
  updateSelBar();
}

//  Playlist save 
async function savePlaylist(){
  const name=document.getElementById('pl-name').value.trim();
  if(!name){document.getElementById('playlistMsg').textContent='enter a playlist name';return;}
  if(!selected.size){document.getElementById('playlistMsg').textContent='no tracks selected';return;}
  const isPublic=document.getElementById('pl-public').value==='true';
  const btn=document.querySelector('.sel-bar .primary'); btn.disabled=true;
  document.getElementById('playlistMsg').textContent='creating...';
  try{
    const user=await(await fetch('/me')).json();
    const pl=await(await fetch('/create-playlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id,name,isPublic})})).json();
    if(!pl.id)throw new Error('failed to create');
    const uris=tracks.filter(t=>selected.has(t.id)).map(t=>t.uri).filter(Boolean);
    await fetch('/add-tracks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playlistId:pl.id,uris})});
    document.getElementById('playlistMsg').textContent='✓ saved "'+name+'"';
    document.getElementById('pl-name').value='';
  }catch(e){document.getElementById('playlistMsg').textContent='error: '+e.message;}
  btn.disabled=false;
}

//  Reset 
function resetAll(){
  document.getElementById('sb-search').value='';
  document.getElementById('sb-source').value='all';
  document.getElementById('sb-explicit').value='all';
  document.getElementById('sb-top').value='all';
  document.getElementById('sb-albumtype').value='all';
  document.getElementById('sb-yfrom').value=1950; document.getElementById('v-yfrom').textContent='1950';
  document.getElementById('sb-yto').value=2026; document.getElementById('v-yto').textContent='2026';
  document.getElementById('sb-popmin').value=0; document.getElementById('v-popmin').textContent='0';
  activePL.clear(); activeG.clear();
  document.getElementById('pl-count').textContent=''; document.getElementById('g-count').textContent='';
  COLS.forEach(c=>{ const cf=colFilters[c.key]; if(!cf)return; if('q'in cf)cf.q=''; if(cf.vals)cf.vals.clear(); if('min'in cf){cf.min=null;cf.max=null;} });
  renderPills('pl'); renderPills('g');
  applyFilters();
}

function exportCSV(){
  const src = filtered.length ? filtered : tracks;
  const headers = ['type','label','description','image','artists','album_name','album_type','release_date','year','track_number','disc_number','duration_ms','explicit','popularity','genres','artist_popularity','isrc','liked','liked_at','playlists','top_short_rank','top_medium_rank','top_long_rank','preview_url','spotify_url','uri'];
  const rows = [headers];
  src.forEach(t => rows.push([
    'song', t.name, '', t.album_image||'',
    (t.artists||[]).join('; '), t.album_name||'', t.album_type||'',
    t.release_date||'', t.year||'', t.track_number||'', t.disc_number||'',
    t.duration_ms||'', t.explicit?'yes':'no', t.popularity!=null?t.popularity:'',
    (t.genres||[]).join('; '), t.artist_popularity!=null?t.artist_popularity:'',
    t.isrc||'', t.liked?'yes':'no', t.liked_at||'',
    (t.playlists||[]).join('; '),
    t.top_short_rank||'', t.top_medium_rank||'', t.top_long_rank||'',
    t.preview_url||'', t.spotify_url||'', t.uri||''
  ]));
  const csv = rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'spotify_library.csv';
  a.click();
}

//  Expose to global scope 
window.connectSpotify=connectSpotify;
window.triggerLoad=triggerLoad;
window.exportCSV=exportCSV;
window.setView=setView;
window.resetAll=resetAll;
window.syncRange=syncRange;
window.clearPillSet=clearPillSet;
window.applyFilters=applyFilters;
window.openColFilter=openColFilter;
window.setSort=setSort;
window.toggleSel=toggleSel;
window.toggleSelById=toggleSelById;
window.selectAllVisible=selectAllVisible;
window.clearSelection=clearSelection;
window.togglePlay=togglePlay;
window.savePlaylist=savePlaylist;
window.renderPills=renderPills;

//  Init 
window.onload=async()=>{
  const d=await(await fetch('/status')).json();
  if(d.authed)document.getElementById('fetchBtn').disabled=false;
  if(d.hasData){ await initLibrary(); }
  if(!d.authed) setStatus('connect spotify to get started');
  else setStatus('',false);
};
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);

  } else if (pathname === '/auth') {
    codeVerifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
      scope: 'user-library-read playlist-read-private playlist-read-collaborative user-top-read playlist-modify-private playlist-modify-public',
      code_challenge_method: 'S256', code_challenge: challenge
    });
    res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${params}` });
    res.end();

  } else if (pathname === '/callback') {
    const code = parsed.query.code;
    if (!code) { res.writeHead(400); res.end('no code'); return; }
    try {
      const data = await spotifyPost('accounts.spotify.com', '/api/token', {
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID, code_verifier: codeVerifier
      });
      if (!data.body.access_token) {
        res.writeHead(500); res.end('auth error: ' + JSON.stringify(data.body)); return;
      }
      accessToken = data.body.access_token;
      refreshToken = data.body.refresh_token;
      tokenExpiry = Date.now() + (data.body.expires_in - 60) * 1000;
      res.writeHead(302, { Location: '/' });
      res.end();
    } catch(e) { res.writeHead(500); res.end('auth error: ' + e.message); }

  } else if (pathname === '/load') {
    res.writeHead(200); res.end('ok');
    loadLibrary();

  } else if (pathname === '/progress') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadProgress));

  } else if (pathname === '/tracks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(libraryCache || { tracks: [], fetched_at: null }));

  } else if (pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authed: !!accessToken, hasData: !!libraryCache }));

  } else if (pathname === '/me') {
    try {
      await ensureToken();
      const data = await safeGet('/v1/me');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: data.id }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }

  } else if (pathname === '/create-playlist' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { userId, name, isPublic } = JSON.parse(body);
        await ensureToken();
        const r = await spotifyApiPost(`/v1/users/${userId}/playlists`, { name, public: isPublic, description: 'Created with Spotify Library Explorer' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });

  } else if (pathname === '/add-tracks' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { playlistId, uris } = JSON.parse(body);
        await ensureToken();
        for (let i = 0; i < uris.length; i += 100) {
          await spotifyApiPost(`/v1/playlists/${playlistId}/tracks`, { uris: uris.slice(i, i+100) });
          await sleep(200);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });

  } else if (pathname === '/export') {
    if (!libraryCache) { res.writeHead(404); res.end('no data'); return; }
    const csv = toCSV(libraryCache.tracks);
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="spotify_library.csv"' });
    res.end(csv);

  } else {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nSpotify Library Explorer v4`);
  console.log(`open http://127.0.0.1:${PORT}\n`);
});
