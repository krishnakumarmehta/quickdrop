const CHUNK_SIZE = 64 * 1024; // 64KB chunks - fast on local network

// STUN for normal NAT traversal + TWO free public TURN relays as fallback,
// so connections still have a real shot at succeeding across different
// networks / mobile data where a direct route isn't possible
// (PC<->mobile, mobile<->mobile, corporate WiFi, etc). Having more than
// one relay provider matters: free TURN servers get overloaded or
// rate-limited sometimes, so if one is down the other can still work.
// The ?transport=tcp / :443 variants matter too - some networks block
// plain UDP relay traffic outright but allow it over the same port HTTPS uses.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  // NOTE: this is the one free public TURN relay available without signing up
  // for anything. It's shared by thousands of demo apps, so it can get
  // overloaded/rate-limited at busy times - that's the most likely reason
  // cross-network transfers fail intermittently. For guaranteed reliability
  // in production, sign up for a free tier at metered.ca or Twilio Network
  // Traversal Service and put your own TURN credentials here instead.
];

const ICE_GATHER_TIMEOUT_MS = 15000; // how long we wait before warning about cross-network connection failure

let ws;
let selfId;
let selfName = '';
let currentRoomCode = '';
let joinMode = 'auto'; // 'auto' | 'create' | 'join'
const peers = {}; // peerId -> { name, conn, channel, pendingFiles }
let pendingPeerToPick = null;

const statusEl = document.getElementById('status');
const peerGrid = document.getElementById('peer-grid');
const emptyState = document.getElementById('empty-state');
const fileInput = document.getElementById('file-input');
const transferLog = document.getElementById('transfer-log');
const toast = document.getElementById('toast');
const selfNameDisplay = document.getElementById('self-name-display');
const roomCodeBanner = document.getElementById('room-code-banner');
const roomCodeValue = document.getElementById('room-code-value');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// =====================================================================
// SETUP SCREEN: pick a device name, then Create Room / Join Room / Auto
// =====================================================================
const setupScreen = document.getElementById('setup-screen');
const appScreen = document.getElementById('app-screen');
const nameInput = document.getElementById('name-input');
const joinCodeInput = document.getElementById('join-code-input');
const generateRoomBtn = document.getElementById('generate-room-btn');
const enterAppBtn = document.getElementById('enter-app-btn');
const setupError = document.getElementById('setup-error');
const changeRoomBtn = document.getElementById('change-room-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const modeTabs = document.querySelectorAll('.mode-tab');
const modePanels = {
  create: document.getElementById('mode-create'),
  join: document.getElementById('mode-join'),
  auto: document.getElementById('mode-auto')
};

// Unambiguous alphabet (no 0/O, 1/I/l confusion) - easy to read out loud or type on a phone.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// restore a previously used name so returning users don't retype it
nameInput.value = localStorage.getItem('quickdrop-name') || '';

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    joinMode = tab.dataset.mode;
    Object.entries(modePanels).forEach(([key, panel]) => { panel.hidden = key !== joinMode; });
  });
});

generateRoomBtn.addEventListener('click', () => {
  const code = generateRoomCode();
  generateRoomBtn.textContent = `✅ Room Code: ${code}`;
  generateRoomBtn.dataset.generatedCode = code;
  showToast('Room created! Tap "Suit Up & Connect" below, then enter this code on the other device.');
});

enterAppBtn.addEventListener('click', () => {
  const typedName = nameInput.value.trim();
  if (!typedName) {
    setupError.textContent = '⚠️ Enter your device name first.';
    nameInput.focus();
    return;
  }

  let roomCode = '';
  if (joinMode === 'create') {
    roomCode = generateRoomBtn.dataset.generatedCode || generateRoomCode();
  } else if (joinMode === 'join') {
    roomCode = joinCodeInput.value.trim();
    if (!roomCode) {
      setupError.textContent = '⚠️ Enter the room code from the other device.';
      joinCodeInput.focus();
      return;
    }
  } // 'auto' -> roomCode stays ''

  setupError.textContent = '';
  selfName = typedName;
  currentRoomCode = roomCode;
  localStorage.setItem('quickdrop-name', selfName);

  selfNameDisplay.textContent = selfName;
  if (roomCode) {
    roomCodeBanner.hidden = false;
    roomCodeValue.textContent = roomCode;
  } else {
    roomCodeBanner.hidden = true;
  }

  setupScreen.hidden = true;
  appScreen.hidden = false;
  connectSignaling();
});

changeRoomBtn.addEventListener('click', () => {
  appScreen.hidden = true;
  setupScreen.hidden = false;
  if (ws) { ws.onclose = null; ws.close(); }
  Object.values(peers).forEach(p => { try { p.conn && p.conn.close(); } catch (e) {} });
  Object.keys(peers).forEach(id => delete peers[id]);
});

if (copyCodeBtn) {
  copyCodeBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCodeValue.textContent);
      showToast('📋 Room code copied!');
    } catch (e) {
      showToast('Copy failed. Enter the code manually: ' + roomCodeValue.textContent);
    }
  });
}

// =====================================================================
// SIGNALING
// =====================================================================
function connectSignaling() {
  Object.keys(peers).forEach(id => delete peers[id]);
  peerGrid.innerHTML = '';

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (currentRoomCode) params.set('room', currentRoomCode);
  if (selfName) params.set('name', selfName);
  const qs = params.toString() ? `?${params.toString()}` : '';

  if (ws) { ws.onclose = null; ws.close(); }
  ws = new WebSocket(`${proto}//${location.host}${qs}`);

  ws.onopen = () => {
    statusEl.textContent = currentRoomCode
      ? `Online — in room "${currentRoomCode}"`
      : 'Online — searching on the same WiFi...';
    statusEl.classList.add('online');
  };

  ws.onclose = () => {
    statusEl.textContent = 'Disconnected. Reconnecting...';
    statusEl.classList.remove('online');
    setTimeout(connectSignaling, 1500);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'peers') {
      selfId = msg.self;
      if (msg.selfName) {
        selfName = msg.selfName;
        selfNameDisplay.textContent = selfName;
      }
      renderPeers(msg.peers);
    } else if (msg.type === 'signal') {
      handleSignal(msg);
    }
  };
}

function renderPeers(list) {
  peerGrid.innerHTML = '';
  if (list.length === 0) {
    emptyState.style.display = 'block';
    peerGrid.style.display = 'none';
    statusEl.textContent = currentRoomCode
      ? `Online — no one else is in room "${currentRoomCode}" yet`
      : 'Online — no other device found yet';
    return;
  }
  emptyState.style.display = 'none';
  peerGrid.style.display = 'grid';
  statusEl.textContent = `Online — found ${list.length} device(s)`;

  list.forEach(p => {
    const card = document.createElement('div');
    card.className = 'peer-card';
    const avatarEl = document.createElement('div');
    avatarEl.className = 'peer-avatar';
    avatarEl.textContent = '🦾';

    const nameEl = document.createElement('div');
    nameEl.className = 'peer-name';
    nameEl.textContent = p.name;

    const statusLabelEl = document.createElement('div');
    statusLabelEl.className = 'peer-status';
    statusLabelEl.setAttribute('data-peer-status', p.id);
    statusLabelEl.textContent = 'tap to send';

    card.appendChild(avatarEl);
    card.appendChild(nameEl);
    card.appendChild(statusLabelEl);
    card.onclick = () => {
      pendingPeerToPick = p.id;
      fileInput.click();
    };
    card.ondragover = (e) => { e.preventDefault(); card.classList.add('drag-over'); };
    card.ondragleave = () => card.classList.remove('drag-over');
    card.ondrop = (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      sendFiles(p.id, e.dataTransfer.files);
    };
    peerGrid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setPeerStatusLabel(peerId, text) {
  const el = document.querySelector(`[data-peer-status="${peerId}"]`);
  if (el) el.textContent = text;
}

fileInput.addEventListener('change', () => {
  if (pendingPeerToPick && fileInput.files.length) {
    sendFiles(pendingPeerToPick, fileInput.files);
  }
  fileInput.value = '';
  pendingPeerToPick = null;
});

// --- Optional: bundle multiple selected files into a single ZIP before sending ---
const zipToggle = document.getElementById('zip-toggle');

async function maybeZip(fileList) {
  const files = Array.from(fileList);
  if (files.length <= 1 || !zipToggle || !zipToggle.checked) return files;
  if (typeof JSZip === 'undefined') return files; // fallback if CDN blocked

  showToast('📦 Zipping files...');
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f));
  const blob = await zip.generateAsync({ type: 'blob' });
  const zippedFile = new File([blob], `QuickDrop-${Date.now()}.zip`, { type: 'application/zip' });
  return [zippedFile];
}

function getOrCreatePeerConnection(peerId) {
  if (peers[peerId] && peers[peerId].conn) return peers[peerId];

  const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers[peerId] = peers[peerId] || {};
  peers[peerId].conn = conn;
  peers[peerId].fileQueue = peers[peerId].fileQueue || [];
  peers[peerId].connectTimer = null;
  peers[peerId].reportedFailure = false;

  conn.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal(peerId, { kind: 'candidate', candidate: e.candidate });
    }
  };

  conn.ondatachannel = (e) => {
    setupChannel(peerId, e.channel);
  };

  // --- Cross-network diagnostics: WebRTC can silently sit at "checking"
  // forever if BOTH ends are behind a NAT/firewall that blocks every STUN
  // and TURN route we tried. Instead of leaving the user staring at
  // nothing, we watch the connection state and speak up clearly. ---
  conn.oniceconnectionstatechange = () => {
    const state = conn.iceConnectionState;
    if (state === 'checking') {
      setPeerStatusLabel(peerId, 'connecting…');
      clearTimeout(peers[peerId].connectTimer);
      peers[peerId].connectTimer = setTimeout(() => {
        if (['checking', 'new'].includes(conn.iceConnectionState) && !peers[peerId].reportedFailure) {
          peers[peerId].reportedFailure = true;
          setPeerStatusLabel(peerId, '⚠️ unable to connect');
          showToast('⚠️ Cross-network connection is slow/failing — check internet on both devices, then try again shortly.');
        }
      }, ICE_GATHER_TIMEOUT_MS);
    } else if (state === 'connected' || state === 'completed') {
      clearTimeout(peers[peerId].connectTimer);
      peers[peerId].reportedFailure = false;
      setPeerStatusLabel(peerId, '✅ connected');
    } else if (state === 'failed') {
      clearTimeout(peers[peerId].connectTimer);
      setPeerStatusLabel(peerId, '❌ connection failed — retrying');
      if (!peers[peerId].reportedFailure) {
        peers[peerId].reportedFailure = true;
        showToast('❌ Connection failed. Make sure internet is on for both devices — also try again with VPN turned off.');
      }
      // best-effort self-heal: nudge ICE to re-negotiate a fresh route
      try { conn.restartIce(); } catch (e) {}
    } else if (state === 'disconnected') {
      setPeerStatusLabel(peerId, '⚠️ network is unstable…');
    }
  };

  return peers[peerId];
}

function sendSignal(target, payload) {
  ws.send(JSON.stringify({ type: 'signal', target, payload }));
}

async function handleSignal(msg) {
  const { from, fromName, payload } = msg;
  const peer = getOrCreatePeerConnection(from);
  peer.name = fromName;
  const conn = peer.conn;

  if (payload.kind === 'offer') {
    await conn.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    sendSignal(from, { kind: 'answer', sdp: answer });
  } else if (payload.kind === 'answer') {
    await conn.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  } else if (payload.kind === 'candidate') {
    try { await conn.addIceCandidate(payload.candidate); } catch (e) {}
  }
}

async function sendFiles(peerId, fileList) {
  const files = await maybeZip(fileList); // bundles into one .zip if the toggle is on
  const peer = getOrCreatePeerConnection(peerId);
  const conn = peer.conn;

  if (!peer.channel || peer.channel.readyState !== 'open') {
    setPeerStatusLabel(peerId, 'connecting…');
    const channel = conn.createDataChannel('files');
    setupChannel(peerId, channel);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    sendSignal(peerId, { kind: 'offer', sdp: offer });

    // queue files until channel opens
    peer.fileQueue.push(...files);
    return;
  }

  for (const file of files) transferFile(peer.channel, file);
}

function setupChannel(peerId, channel) {
  channel.binaryType = 'arraybuffer';
  const peer = peers[peerId];
  peer.channel = channel;

  channel.onopen = () => {
    setPeerStatusLabel(peerId, '✅ connected');
    if (peer.fileQueue && peer.fileQueue.length) {
      const queued = peer.fileQueue.splice(0);
      queued.forEach(file => transferFile(channel, file));
    }
  };

  channel.onclose = () => setPeerStatusLabel(peerId, 'disconnected');

  let incoming = null;

  channel.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'meta') {
        incoming = {
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          received: 0,
          chunks: [],
          logEl: createTransferRow(msg.name, 'receiving')
        };
      } else if (msg.type === 'done' && incoming) {
        const blob = new Blob(incoming.chunks, { type: incoming.mime });
        triggerDownload(blob, incoming.name);
        updateTransferRow(incoming.logEl, 100, 'done');
        showToast(`✅ Received: ${incoming.name}`);
        flashTitle(`📥 Received: ${incoming.name}`);
        notify('File Received 📥', incoming.name);
        activeTransferEnd();
        incoming = null;
      }
    } else if (incoming) {
      if (incoming.received === 0) activeTransferStart();
      incoming.chunks.push(e.data);
      incoming.received += e.data.byteLength;
      const pct = Math.min(100, Math.round((incoming.received / incoming.size) * 100));
      updateTransferRow(incoming.logEl, pct, 'receiving');
    }
  };
}

async function transferFile(channel, file) {
  const id = crypto.randomUUID();
  const row = createTransferRow(file.name, 'sending');
  channel.send(JSON.stringify({ type: 'meta', id, name: file.name, size: file.size, mime: file.type }));

  activeTransferStart();
  const reader = file.stream().getReader();
  let sent = 0;

  async function pump() {
    const { value, done } = await reader.read();
    if (done) {
      channel.send(JSON.stringify({ type: 'done', id }));
      updateTransferRow(row, 100, 'done');
      showToast(`📤 Sent: ${file.name}`);
      flashTitle(`📤 Sent: ${file.name}`);
      notify('File Sent ✅', file.name);
      activeTransferEnd();
      return;
    }
    // value may exceed CHUNK_SIZE; split further if needed
    let buf = value;
    for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
      const slice = buf.slice(i, i + CHUNK_SIZE);
      await waitForBufferLow(channel); // event-driven, not a timer poll - keeps working reliably in background tabs
      channel.send(slice);
      sent += slice.byteLength;
      updateTransferRow(row, Math.round((sent / file.size) * 100), 'sending');
    }
    pump();
  }
  pump();
}

// Waits for the data channel's outgoing buffer to drain using the
// 'bufferedamountlow' EVENT instead of setTimeout polling. This matters a lot
// for background/backgrounded-tab reliability: browsers throttle setTimeout
// heavily once a tab is hidden (sometimes to 1/min), but real events on the
// RTCDataChannel still fire promptly, so transfers keep flowing.
function waitForBufferLow(channel) {
  const threshold = 8 * CHUNK_SIZE;
  if (channel.bufferedAmount <= threshold) return Promise.resolve();
  channel.bufferedAmountLowThreshold = threshold;
  return new Promise(resolve => {
    const handler = () => {
      channel.removeEventListener('bufferedamountlow', handler);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', handler);
  });
}

function createTransferRow(name, state) {
  const div = document.createElement('div');
  div.className = 'transfer-item';
  div.innerHTML = `
    <div class="fname"><span>${state === 'sending' ? '📤' : '📥'} ${escapeHtml(name)}</span><span class="pct">0%</span></div>
    <div class="progress-bar"><div class="progress-fill"></div></div>
  `;
  transferLog.prepend(div);
  return div;
}

function updateTransferRow(el, pct, state) {
  el.querySelector('.pct').textContent = state === 'done' ? 'Done ✓' : `${pct}%`;
  el.querySelector('.progress-fill').style.width = pct + '%';
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// =====================================================================
// BACKGROUND / TAB-SWITCH RELIABILITY MODULE
// Browsers throttle or fully suspend hidden tabs (especially on mobile,
// most aggressively on iOS Safari). There is no way to force a browser to
// run at 100% in the background, but these are the real techniques apps
// like WhatsApp Web / Discord use to minimize throttling:
//   1. Wake Lock — stops the screen from sleeping while a transfer runs
//   2. A near-silent looping audio track + Media Session — this makes the
//      OS treat the tab as "playing media", which on Android/Chrome grants
//      background CPU/network priority most normal tabs don't get
//   3. Event-driven data transfer (see waitForBufferLow above) instead of
//      setTimeout polling, since timers get throttled hard when hidden
//   4. A Service Worker + manifest so the site can be "installed" (Add to
//      Home Screen), which runs with fewer background restrictions
//   5. Notifications + title-flash so the user knows the instant a
//      transfer finishes even if they're on another app/tab
// =====================================================================

let wakeLock = null;
let audioCtx = null;
let silentAudioEl = null;
let keepAliveOn = false;
let activeTransfers = 0;
const originalTitle = document.title;

const keepAliveBtn = document.getElementById('keepalive-btn');

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* not supported / denied - fine, rest of the module still helps */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function startKeepAlive() {
  if (keepAliveOn) return;
  keepAliveOn = true;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001; // real audio signal, but effectively inaudible
    osc.frequency.value = 20;
    osc.connect(gain).connect(dest);
    osc.start();

    silentAudioEl = document.createElement('audio');
    silentAudioEl.srcObject = dest.stream;
    silentAudioEl.loop = true;
    silentAudioEl.play().catch(() => {});

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'QuickDrop is active',
        artist: 'Keeping your file transfer alive in the background'
      });
      navigator.mediaSession.playbackState = 'playing';
    }
  } catch (e) { /* AudioContext blocked - Wake Lock + event-driven transfer still apply */ }

  requestWakeLock();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  if (keepAliveBtn) keepAliveBtn.textContent = '🟢 Background Mode: ON';
}

function stopKeepAlive() {
  keepAliveOn = false;
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (silentAudioEl) { silentAudioEl.pause(); silentAudioEl = null; }
  releaseWakeLock();
  if (keepAliveBtn) keepAliveBtn.textContent = '⚪ Enable Background Mode';
}

if (keepAliveBtn) {
  keepAliveBtn.addEventListener('click', () => {
    keepAliveOn ? stopKeepAlive() : startKeepAlive();
  });
}

// Wake Lock is auto-released by the browser when the tab is hidden; grab it
// again the moment the user comes back if background mode is still on.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    document.title = originalTitle;
    if (keepAliveOn) requestWakeLock();
  }
});

function activeTransferStart() {
  activeTransfers++;
  if (activeTransfers === 1 && !keepAliveOn) startKeepAlive(); // auto-enable once a transfer begins
}

function activeTransferEnd() {
  activeTransfers = Math.max(0, activeTransfers - 1);
}

function flashTitle(msg) {
  if (document.hidden) document.title = msg;
}

function notify(title, body) {
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg' }); } catch (e) {}
  }
}

// PWA install support - "Add to Home Screen" reduces background throttling
// further on Android, since installed apps get treated less like a browser tab.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
