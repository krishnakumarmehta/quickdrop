const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const ADJECTIVES = ['Swift', 'Blue', 'Silent', 'Golden', 'Clever', 'Brave', 'Calm', 'Rapid', 'Bright', 'Quiet'];
const ANIMALS = ['Fox', 'Falcon', 'Tiger', 'Panda', 'Wolf', 'Eagle', 'Otter', 'Hawk', 'Lynx', 'Dolphin'];

function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
}

// The client now asks the user to type their own device name on the
// setup screen and sends it as ?name=... . We trust it only after
// trimming, stripping anything HTML-ish, and capping the length -
// if it's empty/invalid we fall back to a random "Swift Fox" style name
// so the peer list is never blank.
function sanitizeName(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/[<>]/g, '').trim().slice(0, 24);
  return cleaned;
}

// Group clients by the network they appear to be on (proxy-aware).
// This means devices on the SAME wifi/network auto-see each other -
// no random strangers on the internet show up in your peer list.
// If the client passes ?room=CODE, that code is used instead - so two
// devices on DIFFERENT networks (e.g. different mobile data) can also
// connect to each other by typing the same code.
function getRoomKey(req) {
  const fullUrl = new URL(req.url, 'http://localhost');
  const code = (fullUrl.searchParams.get('room') || '').trim().toLowerCase();
  if (code) return `code:${code}`;

  const fwd = req.headers['x-forwarded-for'];
  const ip = fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress;
  return `net:${ip || 'default-room'}`;
}

const rooms = new Map(); // roomKey -> Map(peerId -> ws)

function broadcastPeerList(roomKey) {
  const room = rooms.get(roomKey);
  if (!room) return;
  const peers = [...room.entries()].map(([id, ws]) => ({ id, name: ws.peerName }));
  for (const [id, ws] of room.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'peers',
        self: id,
        selfName: ws.peerName,
        peers: peers.filter(p => p.id !== id)
      }));
    }
  }
}

wss.on('connection', (ws, req) => {
  const roomKey = getRoomKey(req);
  const fullUrl = new URL(req.url, 'http://localhost');
  const chosenName = sanitizeName(fullUrl.searchParams.get('name'));
  const peerId = crypto.randomUUID();
  ws.peerId = peerId;
  ws.peerName = chosenName || randomName();
  ws.roomKey = roomKey;

  if (!rooms.has(roomKey)) rooms.set(roomKey, new Map());
  rooms.get(roomKey).set(peerId, ws);

  broadcastPeerList(roomKey);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'signal' && msg.target) {
      const room = rooms.get(ws.roomKey);
      const target = room && room.get(msg.target);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({
          type: 'signal',
          from: peerId,
          fromName: ws.peerName,
          payload: msg.payload
        }));
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomKey);
    if (room) {
      room.delete(peerId);
      if (room.size === 0) rooms.delete(ws.roomKey);
      else broadcastPeerList(ws.roomKey);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QuickDrop running on http://localhost:${PORT}`);
  console.log('On mobile, connect to same WiFi and open http://<your-computer-local-ip>:' + PORT);
});
