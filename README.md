# QuickDrop ⚡ — Instant P2P File Sharing
### Developed by Krishna

Jaise Snapdrop/AirDrop kaam karta hai — same WiFi par jitne bhi device browser me ye website kholenge, wo apne aap ek-doosre ko dekh lenge aur direct (peer-to-peer, WebRTC) file bhej sakenge. File server se hoke nahi jaati, isliye speed WiFi jitni fast hoti hai. **PC↔PC, PC↔Mobile, Mobile↔Mobile — sab combination me kaam karta hai.**

## ✨ Features
- **Auto-detect**: Website khulte hi same WiFi wale devices turant peer-list me dikh jaate hain — kuch dabana nahi padta
- **Room Code**: Alag network / mobile data walon ko bhi connect karna ho toh dono taraf same code (jaise `opus2`) daal do — turant connect ho jayenge, chahe kahin bhi ho
- **Har file type supported**: APK, PDF, ZIP, Video, Photo, Doc — kuch bhi, koi restriction nahi
- **ZIP bundling**: Multiple files select karo aur "Bundle as ZIP" checkbox on karke ek hi ZIP file me bhejo
- **Fast + Private**: File data seedha device-se-device jaata hai (WebRTC), server sirf introduction karata hai — file kabhi server pe store nahi hoti

## 🚀 Deploy karna (Render.com — recommended, FREE)

> ⚠️ **Vercel is website ke liye kaam NAHI karega** — Vercel serverless hai aur WebSocket (real-time signaling) support nahi karta. Isliye Render, Railway, ya Fly.io use karo — ye sab free tier me persistent Node server chalate hain.

1. Is folder ko GitHub repo me push karo
2. https://render.com par jao → "New +" → "Web Service" → apna GitHub repo select karo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Deploy dabao — 2-3 min me live URL milega (e.g. `https://quickdrop.onrender.com`)
5. Ye URL kisi bhi device se kholo (WiFi ho ya mobile data, farak nahi padta) — same WiFi walon ko auto-detect hoga, alag network walon ke liye dono "Room Code" box me same code daalein

## 🖥️ Local WiFi par chalana (bina deploy kiye)

1. Node.js install karo: https://nodejs.org
2. Terminal me:
   ```
   npm install
   npm start
   ```
3. Terminal me local IP dikhega, jaise `http://192.168.1.5:3000`
   - Local IP nikalne ke liye: Windows → `ipconfig`, Mac/Linux → `ifconfig`
4. Sab devices (PC/mobile) ko **same WiFi** se connect karke browser me wahi URL kholo
5. 2nd device khulte hi dono ek-doosre ko dikhne lagenge — tap karo aur file bhej do

## 🔑 Room Code kab use karo
- **Same WiFi** par ho → kuch mat karo, auto connect ho jayega
- **Alag network / mobile data** par ho (ek phone WiFi pe, doosra 4G/5G pe, ya alag ghar/office) → dono devices me "Room Code" box me exact same word daalo (case-insensitive), Join dabao — turant connect

## ⚙️ Kaise kaam karta hai
- **Signaling server** (Node + WebSocket, `server.js`) sirf devices ko ek-doosre se "introduce" karata hai — same WiFi ya same room-code wale group me daal deta hai
- Asli file transfer **WebRTC DataChannel** se seedha device-se-device jaata hai — 64KB chunks me stream hota hai (RAM overflow nahi hota, badi files bhi chalti hain)
- STUN + free public TURN relay dono configured hain, isliye tricky networks (mobile data, strict NAT) par bhi connection ban jaata hai

## 📁 Files
- `server.js` — signaling server (room grouping: WiFi-based ya code-based)
- `public/index.html`, `style.css`, `client.js` — frontend (UI + WebRTC + ZIP logic)

## 📲 Background Mode (tab switch / app minimize)
Website me ab ek **"Enable Background Mode"** button hai (file bhejte/receive karte waqt khud bhi ON ho jaata hai). Ye 4 real techniques use karta hai:
1. **Wake Lock** — screen sleep nahi hoti jab transfer chal raha ho
2. **Silent keep-alive audio + Media Session** — OS ko lagta hai media play ho raha hai, isliye Chrome/Android tab ko kam throttle karta hai
3. **Event-driven transfer** — background me bhi setTimeout ki jagah real events use hote hain, isliye transfer atakta nahi
4. **PWA install ("Add to Home Screen")** — Android par isse background restrictions aur kam ho jaate hain

**Honest note:** Koi bhi website 100% guarantee nahi de sakti ki app fully band karne ya switch karne ke baad bhi hamesha chalti rahe — ye OS-level policy hai (especially **iPhone/Safari** bahut aggressive hai background tabs suspend karne me). Ye sab techniques throttling ko *kaafi kam* kar dete hain (jaisa WhatsApp Web bhi karta hai), lekin bade files transfer karte waqt best result ke liye:
- Phone ka screen on rakho
- "Add to Home Screen" karke app jaisa install kar lo
- Poori tarah app close mat karo, sirf switch karo
# quickdrop
