// server/server.js
// Entry point — khởi động Express + Socket.IO

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const { setupSocket } = require('./socket');

const app    = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

// ─── Static files ────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/',          (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/game',      (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'game.html')));
app.get('/health',    (_req, res) => res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() }));

// ─── Socket setup ────────────────────────────
setupSocket(io);

// ─── Start ───────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐺 Ma Sói Server đang chạy tại cổng ${PORT}`);
  console.log(`   Môi trường : ${process.env.NODE_ENV || 'development'}`);
});

// ─── Keep-alive cho free hosting (Render/Railway) ─
// Tự ping /health mỗi 14 phút để server không ngủ
if (process.env.SELF_URL) {
  const https = require('https');
  const http2 = require('http');
  setInterval(() => {
    const url  = process.env.SELF_URL + '/health';
    const client = url.startsWith('https') ? https : http2;
    client.get(url, (res) => {
      console.log(`[keep-alive] ping ${url} → ${res.statusCode}`);
    }).on('error', (err) => {
      console.warn('[keep-alive] lỗi:', err.message);
    });
  }, 14 * 60 * 1000);
}

// ─── Xử lý lỗi không bắt được ────────────────
process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
