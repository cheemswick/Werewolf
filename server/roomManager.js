// server/roomManager.js
// Tạo / vào / rời phòng — quản lý toàn bộ state phòng trong RAM

const rooms = new Map(); // code -> room

// ─────────────────────────────────────────────
// Tạo mã phòng 6 ký tự (không nhầm lẫn 0/O, 1/I)
// ─────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ─────────────────────────────────────────────
// Tạo object player
// ─────────────────────────────────────────────
function makePlayer(socketId, name, isHost = false) {
  return {
    id:     socketId,
    name:   String(name).substring(0, 20).trim() || 'Người chơi',
    isHost,
    avatar: Math.floor(Math.random() * 12),
  };
}

// ─────────────────────────────────────────────
// Tạo phòng mới
// ─────────────────────────────────────────────
function createRoom(hostSocketId, hostName, maxPlayers = 10) {
  const code = generateCode();
  const host = makePlayer(hostSocketId, hostName, true);

  const room = {
    code,
    hostId:     hostSocketId,
    maxPlayers: Math.min(16, Math.max(4, parseInt(maxPlayers) || 10)),
    players:    new Map([[hostSocketId, host]]),
    settings: {
      roles: {
        werewolf:   2,
        seer:       1,
        guard:      1,
        witch:      1,
        hunter:     0,
        cupid:      0,
        wolf_cub:   0,
        half_wolf:  0,
        white_wolf: 0,
        thief:      0,
        sheriff:    0,
      },
      tieKillAll:    false,
      witchSelfSave: true,
    },
    gameState:  null,   // null = đang ở lobby
    createdAt:  Date.now(),
  };

  rooms.set(code, room);
  return room;
}

// ─────────────────────────────────────────────
// Vào phòng
// ─────────────────────────────────────────────
function joinRoom(code, socketId, playerName) {
  const room = rooms.get(code.toUpperCase());
  if (!room)                              return { error: 'Không tìm thấy phòng!' };
  if (room.gameState)                     return { error: 'Ván đấu đã bắt đầu rồi!' };
  if (room.players.size >= room.maxPlayers) return { error: `Phòng đã đầy (tối đa ${room.maxPlayers} người)!` };
  if (room.players.has(socketId))         return { error: 'Bạn đã ở trong phòng này!' };

  const player = makePlayer(socketId, playerName);
  room.players.set(socketId, player);
  return { room };
}

// ─────────────────────────────────────────────
// Rời phòng / disconnect
// Trả về { code, room, disbanded, newHostId }
// ─────────────────────────────────────────────
function leaveRoom(socketId) {
  for (const [code, room] of rooms.entries()) {
    if (!room.players.has(socketId)) continue;

    const leavingPlayer = room.players.get(socketId);
    room.players.delete(socketId);

    // Phòng trống → xóa luôn
    if (room.players.size === 0) {
      rooms.delete(code);
      return { code, disbanded: true, leavingPlayer };
    }

    // Chuyển host nếu cần
    let newHostId = room.hostId;
    if (room.hostId === socketId) {
      const next = room.players.values().next().value;
      next.isHost  = true;
      room.hostId  = next.id;
      newHostId    = next.id;
    }

    return { code, room, disbanded: false, leavingPlayer, newHostId };
  }
  return null;
}

// ─────────────────────────────────────────────
// Getters
// ─────────────────────────────────────────────
function getRoom(code) {
  return rooms.get(String(code).toUpperCase()) || null;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

function getPlayersArray(room) {
  return Array.from(room.players.values());
}

// ─────────────────────────────────────────────
// Cleanup phòng rỗng / quá cũ (chạy mỗi 30 phút)
// ─────────────────────────────────────────────
setInterval(() => {
  const now     = Date.now();
  const MAX_AGE = 6 * 60 * 60 * 1000; // 6 tiếng
  let cleaned   = 0;
  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0 || now - room.createdAt > MAX_AGE) {
      rooms.delete(code);
      cleaned++;
    }
  }
  if (cleaned) console.log(`[roomManager] Đã dọn ${cleaned} phòng cũ. Còn lại: ${rooms.size}`);
}, 30 * 60 * 1000);

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getRoomBySocket,
  getPlayersArray,
  rooms,
};
  
