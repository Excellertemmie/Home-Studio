// Home Studio: syncs play/pause/seek between two browsers. Video files never leave your device.
// Signaling: PeerJS free public server. To use your own, set PEER_OPTS = {host:'your-host',port:443,secure:true,path:'/'}
// For strict networks add a TURN server: PEER_OPTS = {config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'turn:YOUR_TURN',username:'u',credential:'p'}]}}
// Relay (TURN) for people on different networks/states. Sign up free at metered.ca, then paste your TURN entries here, e.g.
// const TURN = [{urls:'turn:relay.metered.ca:80',username:'YOUR_USER',credential:'YOUR_PASS'},{urls:'turn:relay.metered.ca:443?transport=tcp',username:'YOUR_USER',credential:'YOUR_PASS'}];
const TURN = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'f7b4673fb38fefb4b1158a44', credential: 'UpbpZmtI0XPyi2Pd' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'f7b4673fb38fefb4b1158a44', credential: 'UpbpZmtI0XPyi2Pd' },
  { urls: 'turn:global.relay.metered.ca:443', username: 'f7b4673fb38fefb4b1158a44', credential: 'UpbpZmtI0XPyi2Pd' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'f7b4673fb38fefb4b1158a44', credential: 'UpbpZmtI0XPyi2Pd' }
];
const PEER_OPTS = TURN.length ? { config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ...TURN] } } : {};
const $ = s => document.querySelector(s), v = $('#video');
const PRE = 'homestudio-', AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let peer, conn, host = false, code = '', off = 0, lock = false, lt, selfWait = false, resume = false;
let key = '', fileName = '', partner = null, retry, left = false, rejoinCode = '', tries = 0, lastSeen = 0, pAway = false, everConn = false, counting = false,
    curFile = null, sending = null, recv = null, liveOut = null, liveCall = null, liveIn = false, cancelFn = null;

let priming = false, reqT;
const quiet = () => lock || priming || document.hidden;
const note = (d, t) => { $('#log').textContent = 'Last sync message: ' + d + ' ' + t; };
const send = o => { if (conn && conn.open) { conn.send(o); if (o.t !== 'beat' && o.t !== 'ping') note('sent', o.t); } };
const pos = () => v.currentTime - off;
const status = (t, s) => { $('#status span').textContent = t; $('#status').dataset.s = s || ''; };
const banner = t => { const b = $('#banner'); b.textContent = t || ''; b.hidden = !t; };
const apply = f => { lock = true; try { f(); } catch (e) {} clearTimeout(lt); lt = setTimeout(() => lock = false, 600); };
const play = () => v.play().catch(() => { $('#tap').hidden = false; });
$('#tap').onclick = () => { $('#tap').hidden = true; v.play(); };

/* ---------- connection ---------- */
function showRoom() { $('#lobby').hidden = true; $('#room').hidden = false; $('#code').textContent = code; $('#mini').textContent = code; fold(false);
  try { localStorage.setItem('hs:room', JSON.stringify({ code, host, at: Date.now() })); } catch (e) {} }
function fold(closed) { $('#room').classList.toggle('closed', closed); $('#roomtoggle').setAttribute('aria-expanded', String(!closed)); }
function create(saved) {
  code = saved || Array.from({ length: 6 }, () => AL[Math.random() * AL.length | 0]).join('');
  host = true; left = false;
  peer = new Peer(PRE + code, PEER_OPTS); bindPeer();
  peer.on('connection', c => { if (conn && conn.open) try { conn.close(); } catch (e) {} setup(c); });
}
function join(c) {
  code = c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return banner('Enter the 6-character room code.');
  host = false; left = false; showRoom(); status('Connecting…', 'wait');
  peer = new Peer(PEER_OPTS); bindPeer(); peer.on('open', dial);
}
function bindPeer() {
  peer.on('open', () => { if (host) { showRoom(); status('Room ready. Waiting for your partner.', 'wait'); } });
  peer.on('disconnected', () => { if (!left) peer.reconnect(); });
  peer.on('call', c => { c.answer(); liveCall = c; c.on('stream', showLive); c.on('close', hideLive); });
  peer.on('error', e => {
    if (e.type === 'unavailable-id' && host) {
      peer.destroy();
      if (rejoinCode && ++tries < 6) return setTimeout(() => create(rejoinCode), 3000);
      rejoinCode = ''; return create();
    }
    if (e.type === 'peer-unavailable') { banner('Room not found yet. Retrying…'); return schedule(); }
    banner('Connection problem (' + e.type + '). Retrying…'); schedule();
  });
}
function dial() { if (left || host || (conn && conn.open) || !peer || peer.destroyed) return; setup(peer.connect(PRE + code, { reliable: true })); }
function schedule() { clearTimeout(retry); if (!host && !left) retry = setTimeout(dial, 3000); }
function setup(c) {
  conn = c;
  const slow = setTimeout(() => {
    if (!c.open && conn === c) { status('Cannot reach partner', 'wait'); banner("Can't connect yet. A network may be blocking direct links. Try switching one of you between Wi-Fi and mobile data, then rejoin."); }
  }, 20000);
  c.on('iceStateChanged', s => {
    if (s === 'failed' && !c.open) { status('Cannot reach partner', 'wait'); banner('Direct connection failed. Switch one of you between Wi-Fi and mobile data, or add a relay (TURN) server in app.js.'); }
  });
  c.on('open', () => { clearTimeout(slow); clearTimeout(retry); banner(''); status('Connected', 'ok'); fold(true); everConn = true; pAway = false; lastSeen = Date.now(); refreshPresence(); hello(); });
  c.on('data', onData);
  const gone = () => {
    if (conn !== c || left) return;
    status(host ? 'Partner left. Waiting for them to rejoin.' : 'Disconnected. Reconnecting…', 'wait');
    banner(host ? 'Your partner disconnected. They can rejoin with the same code.' : 'Connection lost. Trying to rejoin…');
    sending = recv = liveOut = null; if (liveIn) hideLive(); hideX();
    partner = null; info(); fold(false); refreshPresence(); schedule();
  };
  c.on('close', gone); c.on('error', gone);
}
function leave() {
  left = true; clearTimeout(retry);
  try { conn && conn.close(); peer && peer.destroy(); } catch (e) {}
  try { localStorage.removeItem('hs:room'); } catch (e) {}
  conn = peer = null; partner = null; code = ''; everConn = false; pAway = false; refreshPresence(); history.replaceState(null, '', location.pathname);
  $('#room').hidden = true; $('#lobby').hidden = false; banner(''); status('Not connected'); info();
}

/* ---------- messages ---------- */
const hello = () => send({ t: 'hello', dur: v.duration || 0, name: v.src ? fileName : '' });
const beat = f => ({ t: 'beat', p: pos(), pl: !v.paused, f });
const MEDIA = ['play', 'pause', 'seek', 'beat', 'wait', 'ready', 'req'];
function onData(m) {
  const t = m.t, tgt = (m.p || 0) + off;
  lastSeen = Date.now();
  if (t !== 'beat' && t !== 'ping' && t !== 'xc') note('received', t);
  if (MEDIA.includes(t) && (!v.src || liveIn)) return;
  if (SHARE.includes(t)) return shareMsg(m);
  if (t === 'ping') setAway(m.a);
  else if (t === 'hello') { partner = m; info(); updateStart(); }
  else if (t === 'play') apply(() => { if (Math.abs(v.currentTime - tgt) > .5) v.currentTime = tgt; play(); });
  else if (t === 'pause') apply(() => { v.pause(); v.currentTime = tgt; });
  else if (t === 'seek') apply(() => { v.currentTime = tgt; });
  else if (t === 'beat') {
    if (m.f) {
      clearTimeout(reqT);
      apply(() => { v.currentTime = tgt; if (m.pl && v.paused) play(); if (!m.pl && !v.paused) v.pause(); });
      banner('Synced to your partner.'); setTimeout(() => { if ($('#banner').textContent === 'Synced to your partner.') banner(''); }, 2000);
    } else if (!host && m.pl && !v.paused && Math.abs(v.currentTime - tgt) > 1.5) apply(() => { v.currentTime = tgt; });
  }
  else if (t === 'req') send(beat(true));
  else if (t === 'wait') { resume = resume || !v.paused; apply(() => v.pause()); banner('Waiting for your partner…'); }
  else if (t === 'ready') { banner(''); if (resume && !selfWait) apply(play); resume = false; }
  else if (t === 'count') count();
  else if (t === 'chat') chat(m.x, false);
}
v.addEventListener('play', () => { if (!quiet()) send({ t: 'play', p: pos() }); });
v.addEventListener('pause', () => { if (!quiet() && !v.ended) send({ t: 'pause', p: pos() }); });
v.addEventListener('seeked', () => { if (!quiet()) send({ t: 'seek', p: pos() }); });
let waitT;
v.addEventListener('waiting', () => {
  if (quiet() || !v.src) return; clearTimeout(waitT);
  waitT = setTimeout(() => { if (v.readyState < 3 && !v.paused) { selfWait = true; send({ t: 'wait' }); } }, 1500);
});
v.addEventListener('playing', () => { clearTimeout(waitT); if (selfWait) { selfWait = false; send({ t: 'ready' }); } });
setInterval(() => { if (host && v.src && !selfWait) send(beat(false)); }, 2000);

/* ---------- file, subtitles, info ---------- */
$('#file').onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0], true); };
function loadFile(f, prime) {
  curFile = f; fileName = f.name; key = 'hs:' + f.name + f.size;
  v.src = URL.createObjectURL(f); $('#empty').hidden = true; banner('');
  // Brief muted play/pause during this tap so phones allow your partner's play command later
  if (prime) {
    priming = true; v.muted = true;
    v.play().then(() => apply(() => v.pause())).catch(() => {}).finally(() => { v.muted = false; priming = false; });
  }
}
v.onloadedmetadata = () => {
  let s = 0; try { s = +localStorage.getItem(key); } catch (e) {}
  if (s > 5 && s < v.duration - 10) apply(() => { v.currentTime = s; });
  hello(); info();
};
v.onerror = () => { if (v.src) banner("This browser can't play that file. Try an .mp4 (H.264/AAC) copy. .mkv often won't play."); };
setInterval(() => { if (key && !v.paused) try { localStorage.setItem(key, v.currentTime); } catch (e) {} }, 5000);
function info() {
  const el = $('#fileinfo'); el.className = '';
  if (!conn || !conn.open) { el.textContent = v.src ? 'Loaded: ' + fileName : ''; return; }
  if (!partner || !partner.name) { el.textContent = "Waiting for your partner to choose their movie file."; return; }
  if (v.duration && partner.dur && Math.abs(v.duration - partner.dur) > 1.5) {
    el.className = 'warn';
    el.textContent = 'Your files differ in length by ' + Math.abs(v.duration - partner.dur).toFixed(1) + 's. They may be different cuts. Use Offset to line them up.';
  } else el.textContent = 'Both movies loaded. Partner has: ' + partner.name;
}
$('#subs').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  let x = await f.text();
  if (!/^\s*WEBVTT/.test(x)) x = 'WEBVTT\n\n' + x.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
  v.querySelectorAll('track').forEach(t => t.remove());
  const t = document.createElement('track');
  t.kind = 'subtitles'; t.label = 'Subtitles'; t.default = true;
  t.src = URL.createObjectURL(new Blob([x], { type: 'text/vtt' }));
  v.append(t); setTimeout(() => { if (v.textTracks[0]) v.textTracks[0].mode = 'showing'; }, 150);
};

/* ---------- controls ---------- */
function count() {
  if (!v.src) return banner('Choose your movie first.');
  let n = 3; counting = true; updateStart(); apply(() => v.pause());
  const o = $('#overlay'); o.hidden = false; o.textContent = n;
  const i = setInterval(() => {
    n--; if (n > 0) o.textContent = n;
    else { clearInterval(i); o.hidden = true; counting = false; apply(play); updateStart(); }
  }, 1000);
}
$('#start').onclick = () => { if (!conn || !conn.open) return banner('Connect to your partner first.'); send({ t: 'count' }); count(); };
$('#resync').onclick = () => {
  if (!conn || !conn.open) return banner('Connect to your partner first.');
  send({ t: 'req' }); clearTimeout(reqT);
  reqT = setTimeout(() => banner('No reply from your partner. Check they have the movie loaded.'), 3000);
};
$('#fs').onclick = () => {
  const s = $('.screen');
  if (s.requestFullscreen) s.requestFullscreen();
  else if (s.webkitRequestFullscreen) s.webkitRequestFullscreen();
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
};
document.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
  off += +b.dataset.o; $('#off').textContent = (off > 0 ? '+' : '') + off + 's'; send({ t: 'req' });
});
addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|VIDEO|BUTTON/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (k === 'arrowright') v.currentTime += 10;
  else if (k === 'arrowleft') v.currentTime -= 10;
  else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen && v.requestFullscreen();
  else if (k === 'm') v.muted = !v.muted;
});

/* ---------- lobby + chat ---------- */
$('#create').onclick = () => create();
$('#joinf').onsubmit = e => { e.preventDefault(); join($('#codein').value); };
$('#leave').onclick = leave;
$('#roomtoggle').onclick = () => fold(!$('#room').classList.contains('closed'));
let unread = 0;
function foldChat(c) {
  $('.chat').classList.toggle('closed', c); $('#chattoggle').setAttribute('aria-expanded', String(!c));
  if (!c) { unread = 0; $('#unread').hidden = true; $('#msgs').scrollTop = 1e9; }
}
$('#chattoggle').onclick = () => foldChat(!$('.chat').classList.contains('closed'));
foldChat(matchMedia('(max-width:860px)').matches);
const flash = (b, t) => { const o = b.textContent; b.textContent = t; setTimeout(() => b.textContent = o, 1500); };
$('#copycode').onclick = e => { navigator.clipboard.writeText(code); flash(e.target, 'Copied'); };
$('#copylink').onclick = e => { navigator.clipboard.writeText(location.origin + location.pathname + '#' + code); flash(e.target, 'Copied'); };
function chat(x, me) {
  const d = document.createElement('div'); d.textContent = x; if (me) d.className = 'me';
  if (!me && $('.chat').classList.contains('closed')) { unread++; $('#unread').textContent = unread; $('#unread').hidden = false; }
  $('#msgs').append(d); $('#msgs').scrollTop = 1e9;
}
$('#chatf').onsubmit = e => {
  e.preventDefault(); const x = $('#chatin').value.trim(); if (!x) return;
  send({ t: 'chat', x }); chat(x, true); $('#chatin').value = '';
};

/* ---------- share my movie: send the file, or live stream ---------- */
const SHARE = ['xo', 'xg', 'xn', 'xc', 'xe', 'xx', 'lo', 'lg', 'ln', 'ls', 'lx'];
const mb = n => (n / 1e6).toFixed(0) + ' MB';
function showX(txt, pct, cancel) {
  $('#xfer').hidden = false; $('#xtxt').textContent = txt; cancelFn = cancel;
  $('#xbar').hidden = pct == null; if (pct != null) $('#xbar').value = pct; updateStart();
}
function hideX() { $('#xfer').hidden = true; cancelFn = null; updateStart(); }
$('#xcancel').onclick = () => cancelFn && cancelFn();
const cancelSend = () => { send({ t: 'xx' }); sending = null; hideX(); };

// Option A: send the movie file straight to your partner's device
$('#sendfile').onclick = () => {
  if (!curFile) return;
  send({ t: 'xo', name: curFile.name, size: curFile.size, type: curFile.type });
  sending = { off: 0, last: -1 }; showX('Waiting for your partner to accept…', null, cancelSend);
};
async function pump() {
  const f = curFile; if (!f) return;
  const s = sending = { off: 0, last: -1 }, dc = conn.dataChannel;
  showX('Sending ' + f.name + '…', 0, cancelSend);
  while (sending === s && s.off < f.size && conn && conn.open) {
    if ((dc && dc.bufferedAmount > 4e6) || conn.bufferSize > 50) { await new Promise(r => setTimeout(r, 40)); continue; }
    const buf = await f.slice(s.off, s.off + 65536).arrayBuffer();
    if (sending !== s) return;
    conn.send({ t: 'xc', d: buf }); s.off += buf.byteLength;
    const p = Math.floor(s.off / f.size * 100);
    if (p !== s.last) { s.last = p; showX('Sending ' + f.name + ' ' + p + '%', p, cancelSend); }
  }
  if (sending === s && s.off >= f.size) { send({ t: 'xe' }); sending = null; hideX(); banner('Movie sent. Your partner now has it.'); }
}

// Option B: stream the movie live while it plays on your screen
$('#golive').onclick = () => {
  const s = v.captureStream ? v.captureStream() : v.mozCaptureStream ? v.mozCaptureStream() : null;
  if (!s) return banner("This browser can't live stream. Try Chrome on a laptop or Android, or use Send my movie.");
  liveOut = s; send({ t: 'lo' }); showX('Waiting for your partner to accept the live stream…', null, stopLive);
};
function stopLive() {
  send({ t: 'ls' }); try { liveCall && liveCall.close(); } catch (e) {}
  liveCall = liveOut = null; hideX();
}
function showLive(s) {
  liveIn = true; const l = $('#live'); l.srcObject = s; l.hidden = false; l.play().catch(() => {});
  apply(() => v.pause()); showX("Watching your partner's live stream", null, stopWatch);
}
function hideLive() {
  liveIn = false; const l = $('#live'); l.srcObject = null; l.hidden = true;
  try { liveCall && liveCall.close(); } catch (e) {} liveCall = null; hideX();
}
function stopWatch() { send({ t: 'lx' }); hideLive(); }

function shareMsg(m) {
  const t = m.t;
  if (t === 'xo') {
    if (confirm('Your partner wants to send you "' + m.name + '" (' + mb(m.size) + '). Accept?')) {
      recv = { name: m.name, size: m.size, type: m.type, got: 0, parts: [], last: -1 };
      send({ t: 'xg' }); showX('Receiving ' + m.name + '…', 0, () => { send({ t: 'xx' }); recv = null; hideX(); });
    } else send({ t: 'xn' });
  } else if (t === 'xg') pump();
  else if (t === 'xn') { sending = null; hideX(); banner('Your partner declined the movie file.'); }
  else if (t === 'xc' && recv) {
    recv.parts.push(m.d); recv.got += m.d.byteLength;
    if (recv.parts.length > 512) recv.parts = [new Blob(recv.parts)]; // let the browser manage big files
    const p = Math.floor(recv.got / recv.size * 100);
    if (p !== recv.last) { recv.last = p; showX('Receiving ' + recv.name + ' ' + p + '%', p, cancelFn); }
  } else if (t === 'xe' && recv) {
    const f = new File(recv.parts, recv.name, { type: recv.type || 'video/mp4' }), ok = f.size === recv.size;
    recv = null; hideX(); loadFile(f, false);
    banner(ok ? 'Movie received. You can now watch together.' : 'The file may be incomplete. Ask your partner to send it again.');
  } else if (t === 'xx') { sending = recv = null; hideX(); banner('The transfer was cancelled.'); }
  else if (t === 'lo') send({ t: confirm('Your partner wants to live stream their movie to you. Watch?') ? 'lg' : 'ln' });
  else if (t === 'lg' && liveOut) {
    liveCall = peer.call(conn.peer, liveOut);
    showX('Live streaming to your partner. Press play on your movie.', null, stopLive);
  } else if (t === 'ln') { liveOut = null; hideX(); banner('Your partner declined the live stream.'); }
  else if (t === 'ls') hideLive();
  else if (t === 'lx') { try { liveCall && liveCall.close(); } catch (e) {} liveCall = liveOut = null; hideX(); banner('Your partner stopped watching.'); }
}

/* ---------- coming back to the app ---------- */
function wake() {
  if (left || !code) return;
  if (!peer || peer.destroyed) { rejoinCode = code; tries = 0; return host ? create(code) : join(code); }
  if (peer.disconnected) peer.reconnect();
  if (conn && conn.open) {
    // Catch up to your partner; if nobody answers, the link is stale, so drop it and reconnect
    send({ t: 'req' }); clearTimeout(reqT);
    reqT = setTimeout(() => { try { conn.close(); } catch (e) {} }, 4000);
  } else dial();
}
/* ---------- partner presence ---------- */
// Start together is active only when you are connected, both movies are chosen, and playback is paused
function updateStart() {
  const ok = !!(conn && conn.open && v.src && partner && partner.name && v.paused && !counting);
  const b = $('#start'); b.disabled = !ok;
  b.title = ok ? '' : 'Needs: partner connected, both movies chosen, and playback paused';
  $('#sendfile').disabled = $('#golive').disabled = !(conn && conn.open && v.src && !sending && !recv && !liveOut && !liveIn);
}
['play', 'pause', 'ended', 'loadedmetadata'].forEach(e => v.addEventListener(e, updateStart));
function refreshPresence() {
  updateStart();
  const p = $('#presence'), s = p.querySelector('span');
  if (!conn || !conn.open) {
    p.hidden = !everConn; p.dataset.s = ''; s.textContent = 'Partner offline'; return;
  }
  p.hidden = false;
  const quiet = Date.now() - lastSeen > 12000;
  if (pAway) { p.dataset.s = 'wait'; s.textContent = 'Partner is away'; }
  else if (quiet) { p.dataset.s = 'wait'; s.textContent = 'Partner not responding'; }
  else { p.dataset.s = 'ok'; s.textContent = 'Partner is here'; }
}
function sys(x) {
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = x;
  $('#msgs').append(d); $('#msgs').scrollTop = 1e9;
}
function setAway(a) {
  if (a !== pAway) { pAway = a; sys(a ? 'Your partner switched to another app.' : 'Your partner is back.'); }
  refreshPresence();
}
setInterval(() => { if (conn && conn.open) send({ t: 'ping', a: document.hidden }); refreshPresence(); }, 3000);
let wl;
async function keepAwake(on) {
  try {
    if (on && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) {}
}
v.addEventListener('playing', () => keepAwake(true));
v.addEventListener('pause', () => { if (!document.hidden) keepAwake(false); });
document.addEventListener('visibilitychange', () => {
  send({ t: 'ping', a: document.hidden });
  if (document.hidden) return;
  if (!v.paused) keepAwake(true);
  setTimeout(wake, 500);
});

/* ---------- start up: invite link, or rejoin the room from before ---------- */
let saved = null;
try { saved = JSON.parse(localStorage.getItem('hs:room')); } catch (e) {}
if (location.hash.length === 7) join(location.hash.slice(1));
else if (saved && saved.code && Date.now() - saved.at < 6 * 36e5) {
  $('#empty small').textContent = 'Choose the same movie file again. It will resume where you left off.';
  if (saved.host) { rejoinCode = saved.code; create(saved.code); } else join(saved.code);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
