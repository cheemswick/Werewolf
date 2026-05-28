// server/socket.js
// Xử lý toàn bộ socket events: phòng, game, chat, voice/WebRTC

const {
  createRoom, joinRoom, leaveRoom,
  getRoomBySocket, getPlayersArray,
} = require('./roomManager');

const { GameLoop } = require('../game/gameLoop');

// roomCode -> GameLoop instance
const activeGames = new Map();

// ─────────────────────────────────────────────
function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[+] ${socket.id} kết nối`);

    // ══════════════════════════════════════════
    // ROOM — TẠO PHÒNG
    // ══════════════════════════════════════════
    socket.on('room:create', ({ playerName, maxPlayers } = {}) => {
      try {
        const room = createRoom(socket.id, playerName || 'Host', maxPlayers);
        socket.join(room.code);
        socket.emit('room:created', {
          code:       room.code,
          player:     room.players.get(socket.id),
          players:    getPlayersArray(room),
          settings:   room.settings,
          maxPlayers: room.maxPlayers,
          hostId:     room.hostId,
        });
        console.log(`[room] Tạo phòng ${room.code} bởi ${socket.id}`);
      } catch (e) {
        socket.emit('error', 'Không thể tạo phòng.');
        console.error('[room:create]', e);
      }
    });

    // ══════════════════════════════════════════
    // ROOM — VÀO PHÒNG
    // ══════════════════════════════════════════
    socket.on('room:join', ({ code, playerName } = {}) => {
      try {
        if (!code) { socket.emit('room:join_error', 'Thiếu mã phòng!'); return; }

        console.log(`[join] ${socket.id} (${playerName}) vào phòng ${code}`);

        const result = joinRoom(code, socket.id, playerName || 'Khách');
        if (result.error) {
          // Thử tìm trong gameState theo tên nếu game đang chạy
          const { getRoom } = require('./roomManager');
          const existRoom = getRoom(code);
          const game = existRoom ? activeGames.get(existRoom.code) : null;
          if (game && game.state) {
            // Tìm player theo tên
            const gp = Object.values(game.state.players).find(p => p.name === (playerName||'').substring(0,20).trim());
            if (gp) {
              // Cập nhật socket id mới cho player
              const oldId = gp.id;
              gp.id = socket.id;
              game.state.players[socket.id] = gp;
              delete game.state.players[oldId];

              socket.join(existRoom.code);
              console.log(`[rejoin] ${playerName} rejoin với id mới ${socket.id}`);

              socket.emit('game:rejoin', {
                players:   game.getPublicPlayers(),
                myRole:    gp.role,
                myAlive:   gp.alive,
                phase:     game.state.phase,
                round:     game.state.round,
                wolfPack:  gp.alive && ['werewolf','wolf_cub','white_wolf'].includes(gp.role)
                  ? Object.values(game.state.players)
                      .filter(p => ['werewolf','wolf_cub','white_wolf'].includes(p.role) && p.id !== socket.id)
                      .map(p => ({ id: p.id, name: p.name, role: p.role }))
                  : [],
                loverId:   gp.loverId || null,
                loverName: gp.loverId ? game.state.players[gp.loverId]?.name : null,
                loverRole: gp.loverId ? game.state.players[gp.loverId]?.role : null,
                witchPotions: gp.role === 'witch' ? game.state.witchPotions : null,
                isSheriff: gp.isSheriff,
              });
              socket.to(existRoom.code).emit('game:player_reconnected', {
                playerId:   socket.id,
                playerName: gp.name,
              });
              return;
            }
          }
          socket.emit('room:join_error', result.error);
          return;
        }

        const room = result.room;
        socket.join(room.code);

        // Nếu game đang chạy và người này có trong gameState → rejoin
        const game = activeGames.get(room.code);
        if (game && game.state) {
          const gp = game.state.players[socket.id];
          if (gp) {
            console.log(`[rejoin] ${socket.id} rejoin game ${room.code}`);
            socket.emit('game:rejoin', {
              players:   game.getPublicPlayers(),
              myRole:    gp.role,
              myAlive:   gp.alive,
              phase:     game.state.phase,
              round:     game.state.round,
              wolfPack:  gp.alive && ['werewolf','wolf_cub','white_wolf'].includes(gp.role)
                ? Object.values(game.state.players)
                    .filter(p => ['werewolf','wolf_cub','white_wolf'].includes(p.role) && p.id !== socket.id)
                    .map(p => ({ id: p.id, name: p.name, role: p.role }))
                : [],
              loverId:   gp.loverId || null,
              loverName: gp.loverId ? game.state.players[gp.loverId]?.name : null,
              loverRole: gp.loverId ? game.state.players[gp.loverId]?.role : null,
              witchPotions: gp.role === 'witch' ? game.state.witchPotions : null,
              isSheriff: gp.isSheriff,
            });
            socket.to(room.code).emit('game:player_reconnected', {
              playerId:   socket.id,
              playerName: gp.name,
            });
            return;
          }
        }

        // Lobby bình thường
        socket.emit('room:joined', {
          code:       room.code,
          player:     room.players.get(socket.id),
          players:    getPlayersArray(room),
          settings:   room.settings,
          maxPlayers: room.maxPlayers,
          hostId:     room.hostId,
        });

        socket.to(room.code).emit('room:player_joined', {
          player:  room.players.get(socket.id),
          players: getPlayersArray(room),
        });

        console.log(`[room] ${socket.id} (${playerName}) vào phòng ${room.code}`);
      } catch (e) {
        socket.emit('room:join_error', 'Lỗi không xác định.');
        console.error('[room:join]', e);
      }
    });

    // ══════════════════════════════════════════
    // ROOM — CẬP NHẬT CÀI ĐẶT (host only)
    // ══════════════════════════════════════════
    socket.on('room:update_settings', ({ settings } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room || room.hostId !== socket.id) return;
      // Merge an toàn
      if (settings.roles)        Object.assign(room.settings.roles, settings.roles);
      if (settings.tieKillAll    !== undefined) room.settings.tieKillAll    = !!settings.tieKillAll;
      if (settings.witchSelfSave !== undefined) room.settings.witchSelfSave = !!settings.witchSelfSave;
      io.to(room.code).emit('room:settings_updated', { settings: room.settings });
    });

    // ══════════════════════════════════════════
    // ROOM — KICK (host only)
    // ══════════════════════════════════════════
    socket.on('room:kick', ({ targetId } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room || room.hostId !== socket.id) return;
      const target = room.players.get(targetId);
      if (!target) return;

      room.players.delete(targetId);
      io.to(targetId).emit('room:kicked');
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.leave(room.code);
      io.to(room.code).emit('room:player_left', {
        playerId:      targetId,
        playerName:    target.name,
        players:       getPlayersArray(room),
        newHostId:     room.hostId,
      });
    });

    // ══════════════════════════════════════════
    // GAME — BẮT ĐẦU (host only)
    // ══════════════════════════════════════════
    socket.on('game:start', () => {
      const room = getRoomBySocket(socket.id);
      if (!room)                         return;
      if (room.hostId !== socket.id)     return;
      if (activeGames.has(room.code))    return;
      if (room.players.size < 4) {
        socket.emit('error', 'Cần ít nhất 4 người chơi!');
        return;
      }

      console.log(`[game] Bắt đầu phòng ${room.code} — ${room.players.size} người`);

      // 1. Emit game:started TRƯỚC để client redirect sang game.html
      io.to(room.code).emit('game:started', {
        players: Array.from(room.players.values()).map(p => ({
          id: p.id, name: p.name, avatar: p.avatar,
          alive: true, isSheriff: false, isLover: false,
        })),
      });

      // 2. Khởi động game loop sau 1 giây để client kịp load game.html
      setTimeout(() => {
        const game = new GameLoop(room, io);
        activeGames.set(room.code, game);
        const ok = game.start();
        if (!ok) {
          activeGames.delete(room.code);
          console.error('[game] Không thể bắt đầu game');
        }
      }, 1500);
    });

    // ══════════════════════════════════════════
    // GAME — HÀNH ĐỘNG BAN ĐÊM
    // ══════════════════════════════════════════
    socket.on('night:action', ({ phase, action } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const game = activeGames.get(room.code);
      if (!game || !game.state) return;
      game.handleNightAction(socket.id, phase, action || {});
    });

    // Hunter bắn
    socket.on('night:hunter_shoot', ({ targetId } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const game = activeGames.get(room.code);
      if (!game) return;
      game.handleHunterShoot(socket.id, targetId);
    });

    // ══════════════════════════════════════════
    // GAME — VOTE BAN NGÀY
    // ══════════════════════════════════════════
    socket.on('game:vote', ({ targetId } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const game = activeGames.get(room.code);
      if (!game) return;
      game.handleVote(socket.id, targetId);
    });

    // ══════════════════════════════════════════
    // GAME — BẦU CẢNH SÁT TRƯỞNG
    // ══════════════════════════════════════════
    socket.on('game:sheriff_vote', ({ targetId } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const game = activeGames.get(room.code);
      if (!game || !game.state) return;
      if (game.state.phase !== 'sheriff_election') return;
      game.handleSheriffVote(socket.id, targetId);
    });

    // Cảnh sát trưởng chọn kế nhiệm
    socket.on('game:sheriff_succession', ({ newSheriffId } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const game = activeGames.get(room.code);
      if (!game) return;
      game.handleSheriffSuccession(socket.id, newSheriffId);
    });

    // ══════════════════════════════════════════
    // CHAT
    // ══════════════════════════════════════════
    socket.on('chat:message', ({ message } = {}) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      const msg = String(message || '').substring(0, 200).trim();
      if (!msg) return;

      const game = activeGames.get(room.code);

      if (game && game.state) {
        const player = game.state.players[socket.id];
        if (!player) return;

        // Người chết → ghost chat (chỉ người chết nhìn thấy)
        if (!player.alive) {
          const deadIds = Object.values(game.state.players)
            .filter(p => !p.alive).map(p => p.id);
          deadIds.forEach(id => {
            io.to(id).emit('chat:ghost_message', {
              senderId:   socket.id,
              senderName: player.name,
              message:    msg,
              timestamp:  Date.now(),
            });
          });
          return;
        }

        // Sói chat riêng ban đêm
        const nightPhases = ['night','night_werewolf','night_guard','night_witch','night_seer','night_cupid','night_thief'];
        const isWolf = ['werewolf','wolf_cub','white_wolf'].includes(player.role);
        if (nightPhases.includes(game.state.phase) && isWolf) {
          const wolfIds = Object.values(game.state.players)
            .filter(p => ['werewolf','wolf_cub','white_wolf'].includes(p.role))
            .map(p => p.id);
          wolfIds.forEach(id => {
            io.to(id).emit('chat:wolf_message', {
              senderId:   socket.id,
              senderName: player.name,
              message:    msg,
              timestamp:  Date.now(),
            });
          });
          return;
        }

        // Chat ngày bình thường
        const dayPhases = ['day_chat','day_vote','vote_result','sheriff_election'];
        if (dayPhases.includes(game.state.phase)) {
          io.to(room.code).emit('chat:message', {
            senderId:   socket.id,
            senderName: player.name,
            message:    msg,
            timestamp:  Date.now(),
          });
        }
      } else {
        // Lobby chat
        const lobbyPlayer = room.players.get(socket.id);
        if (!lobbyPlayer) return;
        io.to(room.code).emit('chat:message', {
          senderId:   socket.id,
          senderName: lobbyPlayer.name,
          message:    msg,
          timestamp:  Date.now(),
        });
      }
    });

    // ══════════════════════════════════════════
    // VOICE — WebRTC Signaling
    // ══════════════════════════════════════════
    socket.on('voice:join', () => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      socket.to(room.code).emit('voice:user_joined', { userId: socket.id });
    });

    socket.on('voice:leave', () => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      socket.to(room.code).emit('voice:user_left', { userId: socket.id });
    });

    socket.on('voice:offer', ({ targetId, offer } = {}) => {
      if (!targetId || !offer) return;
      io.to(targetId).emit('voice:offer', { fromId: socket.id, offer });
    });

    socket.on('voice:answer', ({ targetId, answer } = {}) => {
      if (!targetId || !answer) return;
      io.to(targetId).emit('voice:answer', { fromId: socket.id, answer });
    });

    socket.on('voice:ice', ({ targetId, candidate } = {}) => {
      if (!targetId || !candidate) return;
      io.to(targetId).emit('voice:ice', { fromId: socket.id, candidate });
    });

    // ══════════════════════════════════════════
    // DISCONNECT
    // ══════════════════════════════════════════
    socket.on('disconnect', () => {
      console.log(`[-] ${socket.id} ngắt kết nối`);

      const result = leaveRoom(socket.id);
      if (!result) return;

      const { code, room, disbanded, leavingPlayer, newHostId } = result;

      if (disbanded) {
        // Phòng tan → hủy game
        const game = activeGames.get(code);
        if (game) { game.clearTimers(); activeGames.delete(code); }
        console.log(`[room] Phòng ${code} tan vì trống`);
        return;
      }

      // Thông báo người còn lại
      io.to(code).emit('room:player_left', {
        playerId:   socket.id,
        playerName: leavingPlayer?.name || '?',
        players:    getPlayersArray(room),
        newHostId,
      });

      // Nếu game đang chạy, đánh dấu disconnect
      const game = activeGames.get(code);
      if (game && game.state) {
        const gp = game.state.players[socket.id];
        if (gp) {
          io.to(code).emit('game:player_disconnected', {
            playerId:   socket.id,
            playerName: gp.name,
          });
        }
      }

      // Dọn game đã kết thúc
      const game2 = activeGames.get(code);
      if (game2 && game2.state?.phase === 'game_over') {
        game2.clearTimers();
        activeGames.delete(code);
      }
    });
  });
}

module.exports = { setupSocket };
