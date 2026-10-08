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
let key = '', fileName = '', partner = null, retry, left = false, rejoinCode = '', tries = 0;

let priming = false, reqT;
const quiet = () => lock || priming || document.hidden;
const note = (d, t) => { $('#log').textContent = 'Last sync message: ' + d + ' ' + t; };
const send = o => { if (conn && conn.open) { conn.send(o); if (o.t !== 'beat') note('sent', o.t); } };
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
  c.on('open', () => { clearTimeout(slow); clearTimeout(retry); banner(''); status('Connected', 'ok'); fold(true); hello(); });
  c.on('data', onData);
  const gone = () => {
    if (conn !== c || left) return;
    status(host ? 'Partner left. Waiting for them to rejoin.' : 'Disconnected. Reconnecting…', 'wait');
    banner(host ? 'Your partner disconnected. They can rejoin with the same code.' : 'Connection lost. Trying to rejoin…');
    partner = null; info(); fold(false); schedule();
  };
  c.on('close', gone); c.on('error', gone);
}
function leave() {
  left = true; clearTimeout(retry);
  try { conn && conn.close(); peer && peer.destroy(); } catch (e) {}
  try { localStorage.removeItem('hs:room'); } catch (e) {}
  conn = peer = null; partner = null; code = ''; history.replaceState(null, '', location.pathname);
  $('#room').hidden = true; $('#lobby').hidden = false; banner(''); status('Not connected'); info();
}

/* ---------- messages ---------- */
const hello = () => send({ t: 'hello', dur: v.duration || 0, name: v.src ? fileName : '' });
const beat = f => ({ t: 'beat', p: pos(), pl: !v.paused, f });
const MEDIA = ['play', 'pause', 'seek', 'beat', 'wait', 'ready', 'req'];
function onData(m) {
  const t = m.t, tgt = (m.p || 0) + off;
  if (t !== 'beat') note('received', t);
  if (MEDIA.includes(t) && !v.src) return;
  if (t === 'hello') { partner = m; info(); }
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
$('#file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  fileName = f.name; key = 'hs:' + f.name + f.size;
  v.src = URL.createObjectURL(f); $('#empty').hidden = true; banner('');
  // Brief muted play/pause during this tap so phones allow your partner's play command later
  priming = true; v.muted = true;
  v.play().then(() => apply(() => v.pause())).catch(() => {}).finally(() => { v.muted = false; priming = false; });
};
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
  let n = 3; apply(() => v.pause());
  const o = $('#overlay'); o.hidden = false; o.textContent = n;
  const i = setInterval(() => {
    n--; if (n > 0) o.textContent = n;
    else { clearInterval(i); o.hidden = true; apply(play); }
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
const flash = (b, t) => { const o = b.textContent; b.textContent = t; setTimeout(() => b.textContent = o, 1500); };
$('#copycode').onclick = e => { navigator.clipboard.writeText(code); flash(e.target, 'Copied'); };
$('#copylink').onclick = e => { navigator.clipboard.writeText(location.origin + location.pathname + '#' + code); flash(e.target, 'Copied'); };
function chat(x, me) {
  const d = document.createElement('div'); d.textContent = x; if (me) d.className = 'me';
  $('#msgs').append(d); $('#msgs').scrollTop = 1e9;
}
$('#chatf').onsubmit = e => {
  e.preventDefault(); const x = $('#chatin').value.trim(); if (!x) return;
  send({ t: 'chat', x }); chat(x, true); $('#chatin').value = '';
};

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
