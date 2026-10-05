# QuickDrop ⚡ — Instant P2P File Sharing
### Developed by Krishna

Works like Snapdrop/AirDrop: any devices on the same WiFi that open this website in a browser will automatically discover each other and send files directly (peer-to-peer, WebRTC). Files do not pass through the server, so transfer speed is as fast as your WiFi. **PC↔PC, PC↔Mobile, Mobile↔Mobile — all combinations work.**

## ✨ Features
- **Auto-detect**: As soon as the site opens, devices on the same WiFi appear in the peer list automatically — no extra action needed
- **Room Code**: To connect devices on different networks/mobile data, enter the same code (for example `opus2`) on both sides — they connect instantly from anywhere
- **All file types supported**: APK, PDF, ZIP, Video, Photo, Docs — no restrictions
- **ZIP bundling**: Select multiple files and enable "Bundle as ZIP" to send everything as one ZIP file
- **Fast + Private**: File data goes directly device-to-device (WebRTC). The server only introduces peers — files are never stored on the server

## 🚀 Deployment (Render.com — recommended, FREE)

> ⚠️ **Vercel will NOT work for this website** — Vercel is serverless and does not support persistent WebSocket signaling. Use Render, Railway, or Fly.io instead; all provide free tiers with persistent Node servers.

1. Push this folder to a GitHub repository
2. Go to https://render.com → "New +" → "Web Service" → select your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Click Deploy — you will get a live URL in 2-3 minutes (for example `https://quickdrop.onrender.com`)
5. Open that URL on any device (WiFi or mobile data). Same-WiFi devices auto-detect; for different networks, enter the same value in both "Room Code" boxes

## 🖥️ Run on local WiFi (without deployment)

1. Install Node.js: https://nodejs.org
2. In a terminal:
   ```
   npm install
   npm start
   ```
3. The terminal will show your local IP, for example `http://192.168.1.5:3000`
   - To find local IP manually: Windows → `ipconfig`, Mac/Linux → `ifconfig`
4. Connect all devices (PC/mobile) to the **same WiFi** and open that URL in a browser
5. As soon as the second device opens it, both devices will see each other — tap and send files

## 🔑 When to use Room Code
- On **same WiFi** → do nothing, auto-connect will work
- On **different networks / mobile data** (for example one phone on WiFi, another on 4G/5G, or in different homes/offices) → enter the exact same value in both devices' "Room Code" boxes (case-insensitive), then tap Join

## ⚙️ How it works
- The **signaling server** (Node + WebSocket, `server.js`) only introduces devices to each other — it groups by same WiFi or same room code
- Actual file transfer happens directly over **WebRTC DataChannel** — streamed in 64KB chunks (avoids RAM spikes and supports large files)
- Both STUN and free public TURN relays are configured, so connections can still work on difficult networks (mobile data, strict NAT)

## 📁 Files
- `server.js` — signaling server (room grouping: WiFi-based or code-based)
- `public/index.html`, `style.css`, `client.js` — frontend (UI + WebRTC + ZIP logic)

## 📲 Background Mode (tab switch / app minimize)
The website now includes an **"Enable Background Mode"** button (it also turns on automatically while sending/receiving files). It uses 4 real techniques:
1. **Wake Lock** — keeps the screen from sleeping while transfer is running
2. **Silent keep-alive audio + Media Session** — makes the OS treat it like active media, so Chrome/Android throttles less
3. **Event-driven transfer** — uses real events instead of setTimeout polling in background, reducing stalls
4. **PWA install ("Add to Home Screen")** — further reduces background restrictions on Android

**Honest note:** No website can guarantee 100% uninterrupted background execution after fully closing/switching apps — this is controlled by OS-level policy (especially **iPhone/Safari**, which suspends background tabs aggressively). These techniques reduce throttling significantly (similar to WhatsApp Web), but for best large-file transfer results:
- Keep the phone screen on
- Install via "Add to Home Screen"
- Do not fully close the app; just switch away
# quickdrop
