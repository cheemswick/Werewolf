// game/gameLoop.js

const {
  ROLES, TEAMS, NIGHT_PHASES,
  isWerewolf, buildRoleList, buildNightQueue,
  getAlivePlayers, getAliveWolves, getAliveVillagers,
  isRoleAlive,
} = require('../roles/index');

const DURATION = {
  DAY_CHAT:       30_000,
  DAY_VOTE:       90_000,
  VOTE_RESULT:     5_000,
  NIGHT_ACTION:   30_000,
  NIGHT_FAKE_MIN:  5_000,
  NIGHT_FAKE_MAX: 10_000,
  SHERIFF_VOTE:   30_000,
  HUNTER_SHOOT:   15_000,
  SHOW_RESULT:     4_000,
};

class GameLoop {
  constructor(room, io) {
    this.room    = room;
    this.io      = io;
    this.code    = room.code;
    this.state   = null;
    this._timers = [];
  }

  emit(event, data)             { this.io.to(this.code).emit(event, data); }
  emitTo(socketId, event, data) { this.io.to(socketId).emit(event, data); }

  _setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    this._timers.push(t);
    return t;
  }

  clearTimers() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }

  // ── Getters ──────────────────────────────
  getAlivePlayers()    { return getAlivePlayers(this.state.players); }
  getAliveWolves()     { return getAliveWolves(this.state.players); }
  getAliveVillagers()  { return getAliveVillagers(this.state.players); }
  getPlayer(id)        { return this.state.players[id] || null; }
  hasRoleAlive(roleId) { return isRoleAlive(roleId, this.state.players); }

  getPublicPlayers() {
    return Object.values(this.state.players).map(p => ({
      id:        p.id,
      name:      p.name,
      avatar:    p.avatar,
      alive:     p.alive,
      isSheriff: p.isSheriff,
      isLover:   p.isLover,
    }));
  }

  // ════════════════════════════════════════
  // KHỞI ĐỘNG GAME
  // ════════════════════════════════════════
  start() {
    const players = Array.from(this.room.players.values());
    if (players.length < 4) return false;

    const { roles, thiefExtraRoles } = buildRoleList(players.length, this.room.settings);
    const shuffledRoles   = [...roles].sort(() => Math.random() - 0.5);
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

    const gamePlayers = {};
    shuffledPlayers.forEach((p, i) => {
      gamePlayers[p.id] = {
        id:              p.id,
        name:            p.name,
        avatar:          p.avatar,
        role:            shuffledRoles[i] || ROLES.VILLAGER,
        originalRole:    shuffledRoles[i] || ROLES.VILLAGER,
        alive:           true,
        isSheriff:       false,
        isLover:         false,
        loverId:         null,
        loverTeam:       null,
      };
    });

    this.state = {
      phase:             'lobby',
      round:             0,
      players:           gamePlayers,
      // Đêm
      nightActions:      {},
      killedByWolf:      null,
      killedThisNight:   [],
      guardLastTarget:   null,
      witchPotions:      { save: true, poison: true },
      wolfCubDied:       false,
      doubleBiteNext:    false,
      whiteWolfLastKill: 0,
      // Cặp đôi
      lovers:            null,
      loverTeam:         null,
      // Thief
      thiefExtraRoles:   thiefExtraRoles || [],
      thiefDone:         false,
      // Vote
      voting:            null,
      // Sheriff
      sheriffElected:    false,
      pendingHunter:     null,
      // Già Làng
      elderLives:        2,       // số mạng còn lại của Già Làng
      elderDead:         false,   // khi Già Làng chết → mất kỹ năng
      // Thằng Ngốc
      foolRevealed:      false,   // đã lộ role chưa
      // Kẻ Phóng Hỏa
      oiledPlayers:      new Set(), // danh sách người bị tẩm xăng
      arsonistBurned:    false,   // đã đốt chưa (có thể reset)
      // Sói Đen
      blackWolfConverted: false,  // đã dùng convert chưa
    };

    this.room.gameState = this.state;

    // Gửi role cho từng người
    Object.values(gamePlayers).forEach(p => {
      const payload = { role: p.role };
      if (isWerewolf(p.role)) {
        // Sói Con KHÔNG biết pack, không vote đêm
        if (p.role !== ROLES.WOLF_CUB) {
          payload.wolfPack = Object.values(gamePlayers)
            .filter(x => isWerewolf(x.role) && x.id !== p.id && x.role !== ROLES.WOLF_CUB)
            .map(x => ({ id: x.id, name: x.name, role: x.role }));
        }
      }
      this.emitTo(p.id, 'game:role_assigned', payload);
    });

    this.emit('game:started', { players: this.getPublicPlayers() });

    if (this.room.settings.roles.sheriff) {
      this._startSheriffElection();
    } else {
      this._startNight();
    }

    return true;
  }

  // ════════════════════════════════════════
  // BẦU CẢNH SÁT TRƯỞNG
  // ════════════════════════════════════════
  _startSheriffElection() {
    this.state.phase  = 'sheriff_election';
    this.state.voting = this._initVoting();

    this.emit('game:sheriff_election', {
      players:  this.getPublicPlayers(),
      duration: DURATION.SHERIFF_VOTE,
    });

    this._sheriffTimer = this._setTimeout(() => this._endSheriffElection(), DURATION.SHERIFF_VOTE);
  }

  handleSheriffVote(socketId, targetId) {
    if (this.state.phase !== 'sheriff_election') return;
    const voter = this.getPlayer(socketId);
    if (!voter || !voter.alive) return;
    this.state.voting.votes[socketId] = targetId;
    this.emit('game:sheriff_vote_update', {
      voterId:    socketId,
      targetId,
      votedCount: Object.keys(this.state.voting.votes).length,
      totalAlive: this.getAlivePlayers().length,
    });
    // Tất cả đã vote → kết thúc sớm
    if (Object.keys(this.state.voting.votes).length >= this.getAlivePlayers().length) {
      clearTimeout(this._sheriffTimer);
      this._setTimeout(() => this._endSheriffElection(), 800);
    }
  }

  _endSheriffElection() {
    const result = this._tallyVotes();
    if (result.executed && !Array.isArray(result.executed) && result.executed !== 'skip') {
      const p = this.getPlayer(result.executed);
      if (p) { p.isSheriff = true; this.state.sheriffElected = true; }
    }
    const sheriff = Object.values(this.state.players).find(p => p.isSheriff);
    this.emit('game:sheriff_result', {
      sheriffId:   sheriff?.id   || null,
      sheriffName: sheriff?.name || null,
      players:     this.getPublicPlayers(),
    });
    this.state.voting = null;
    this._setTimeout(() => this._startNight(), 3000);
  }

  // ════════════════════════════════════════
  // ĐÊM
  // ════════════════════════════════════════
  _startNight() {
    this.state.round++;
    this.state.phase           = 'night';
    this.state.killedByWolf    = null;
    this.state.killedThisNight = [];
    this.state.nightActions    = {};

    if (this.state.wolfCubDied) {
      this.state.doubleBiteNext = true;
      this.state.wolfCubDied    = false;
    }

    this.emit('game:night_start', { round: this.state.round });

    const queue = buildNightQueue(this.state.round, this.room.settings, this.state.players);
    this._processNightQueue(queue, 0);
  }

  _processNightQueue(queue, idx) {
    if (idx >= queue.length) {
      this._resolveNight();
      return;
    }
    const phase = queue[idx];
    const next  = () => this._processNightQueue(queue, idx + 1);
    this._runNightPhase(phase, next);
  }

  _runNightPhase(phase, onDone) {
    this.state.phase = phase;

    // Map phase → role cần còn sống để phase là thật
    const phaseRoleMap = {
      [NIGHT_PHASES.THIEF]:      ROLES.THIEF,
      [NIGHT_PHASES.WEREWOLF]:   null,
      [NIGHT_PHASES.GUARD]:      ROLES.GUARD,
      [NIGHT_PHASES.WITCH]:      ROLES.WITCH,
      [NIGHT_PHASES.SEER]:       ROLES.SEER,
      [NIGHT_PHASES.CUPID]:      ROLES.CUPID,
      [NIGHT_PHASES.WHITE_WOLF]: ROLES.WHITE_WOLF,
      [NIGHT_PHASES.BLACK_WOLF]: ROLES.BLACK_WOLF,
      [NIGHT_PHASES.ARSONIST]:   ROLES.ARSONIST,
    };

    let isReal;
    if (phase === NIGHT_PHASES.WEREWOLF) {
      isReal = this.getAliveWolves().filter(w => w.role !== ROLES.WOLF_CUB).length > 0;
    } else if (phase === NIGHT_PHASES.WHITE_WOLF) {
      const ww = this.hasRoleAlive(ROLES.WHITE_WOLF);
      const cycleOk = (this.state.round - this.state.whiteWolfLastKill) >= 2;
      isReal = ww && cycleOk;
    } else if (phase === NIGHT_PHASES.THIEF) {
      isReal = !this.state.thiefDone && this.hasRoleAlive(ROLES.THIEF);
    } else if (phase === NIGHT_PHASES.BLACK_WOLF) {
      isReal = this.hasRoleAlive(ROLES.BLACK_WOLF) && !this.state.blackWolfConverted;
    } else if (phase === NIGHT_PHASES.GUARD) {
      // Già Làng chết → Bảo Vệ mất kỹ năng
      isReal = this.hasRoleAlive(ROLES.GUARD) && !this.state.elderDead;
    } else if (phase === NIGHT_PHASES.WITCH) {
      // Già Làng chết → Phù Thủy mất kỹ năng
      isReal = this.hasRoleAlive(ROLES.WITCH) && !this.state.elderDead;
    } else if (phase === NIGHT_PHASES.SEER) {
      // Già Làng chết → Tiên Tri mất kỹ năng
      isReal = this.hasRoleAlive(ROLES.SEER) && !this.state.elderDead;
    } else {
      const req = phaseRoleMap[phase];
      isReal = req ? this.hasRoleAlive(req) : true;
    }

    const duration = isReal
      ? DURATION.NIGHT_ACTION
      : DURATION.NIGHT_FAKE_MIN + Math.floor(Math.random() * (DURATION.NIGHT_FAKE_MAX - DURATION.NIGHT_FAKE_MIN));

    this.emit('game:night_phase', { phase, duration, isFake: !isReal });

    if (isReal) this._sendNightActionUI(phase);

    this._setTimeout(onDone, duration);
  }

  _sendNightActionUI(phase) {
    const s     = this.state;
    const alive = this.getAlivePlayers();

    switch (phase) {

      // ── Ăn Trộm ──────────────────────────
      case NIGHT_PHASES.THIEF: {
        const thief = alive.find(p => p.role === ROLES.THIEF);
        if (!thief || s.thiefDone) break;
        // Lấy danh sách tất cả người còn sống trừ thief để chọn đổi role
        const targets = alive
          .filter(p => p.id !== thief.id)
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(thief.id, 'night:thief_action', {
          targets,
          extraRoles: s.thiefExtraRoles,
        });
        break;
      }

      // ── Ma Sói ───────────────────────────
      case NIGHT_PHASES.WEREWOLF: {
        // Sói Con KHÔNG tham gia vote đêm
        const wolves  = this.getAliveWolves().filter(w => w.role !== ROLES.WOLF_CUB);
        const targets = alive
          .filter(p => !isWerewolf(p.role))
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        wolves.forEach(w => {
          this.emitTo(w.id, 'night:werewolf_action', {
            targets,
            doubleBite: s.doubleBiteNext,
            wolfPack:   wolves.filter(x => x.id !== w.id).map(x => ({ id: x.id, name: x.name })),
          });
        });
        break;
      }

      // ── Bảo Vệ ───────────────────────────
      case NIGHT_PHASES.GUARD: {
        const guard = alive.find(p => p.role === ROLES.GUARD);
        if (!guard) break;
        const targets = alive
          .filter(p => p.id !== s.guardLastTarget)
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(guard.id, 'night:guard_action', { targets });
        break;
      }

      // ── Phù Thủy ─────────────────────────
      case NIGHT_PHASES.WITCH: {
        const witch = alive.find(p => p.role === ROLES.WITCH);
        if (!witch) break;
        const poisonTargets = alive
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(witch.id, 'night:witch_action', {
          killedId:       s.killedByWolf,
          killedName:     s.killedByWolf ? s.players[s.killedByWolf]?.name : null,
          potions:        { ...s.witchPotions },
          canSelfSave:    this.room.settings.witchSelfSave !== false,
          poisonTargets,
        });
        break;
      }

      // ── Tiên Tri ─────────────────────────
      case NIGHT_PHASES.SEER: {
        const seer = alive.find(p => p.role === ROLES.SEER);
        if (!seer) break;
        // Không được soi đêm đầu
        if (s.round === 1) break;
        const targets = alive
          .filter(p => p.id !== seer.id)
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(seer.id, 'night:seer_action', { targets });
        break;
      }

      // ── Cupid ─────────────────────────────
      case NIGHT_PHASES.CUPID: {
        const cupid = alive.find(p => p.role === ROLES.CUPID);
        if (!cupid) break;
        this.emitTo(cupid.id, 'night:cupid_action', {
          targets: alive.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
        });
        break;
      }

      // ── Sói Trắng ────────────────────────
      case NIGHT_PHASES.WHITE_WOLF: {
        const ww = alive.find(p => p.role === ROLES.WHITE_WOLF);
        if (!ww) break;
        const targets = this.getAliveWolves()
          .filter(w => w.id !== ww.id)
          .map(w => ({ id: w.id, name: w.name, avatar: w.avatar }));
        this.emitTo(ww.id, 'night:white_wolf_action', { targets });
        break;
      }

      // ── Sói Đen ──────────────────────────
      case NIGHT_PHASES.BLACK_WOLF: {
        const bw = alive.find(p => p.role === ROLES.BLACK_WOLF);
        if (!bw || s.blackWolfConverted) break;
        // Không convert phe thứ ba, Sói Trắng, Sói Đen khác
        const noConvert = [ROLES.WHITE_WOLF, ROLES.BLACK_WOLF, ROLES.FOOL, ROLES.ARSONIST];
        const targets = alive
          .filter(p => p.id !== bw.id && !isWerewolf(p.role) && !noConvert.includes(p.role))
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(bw.id, 'night:black_wolf_action', { targets });
        break;
      }

      // ── Kẻ Phóng Hỏa ─────────────────────
      case NIGHT_PHASES.ARSONIST: {
        const ar = alive.find(p => p.role === ROLES.ARSONIST);
        if (!ar) break;
        const targets = alive
          .filter(p => p.id !== ar.id)
          .map(p => ({
            id:     p.id,
            name:   p.name,
            avatar: p.avatar,
            oiled:  s.oiledPlayers.has(p.id),
          }));
        this.emitTo(ar.id, 'night:arsonist_action', {
          targets,
          oiledCount: s.oiledPlayers.size,
          canBurn:    s.oiledPlayers.size > 0,
        });
        break;
      }
    }
  }

  // ════════════════════════════════════════
  // XỬ LÝ HÀNH ĐỘNG ĐÊM
  // ════════════════════════════════════════
  handleNightAction(socketId, phase, action) {
    const s      = this.state;
    const player = s.players[socketId];
    if (!player || !player.alive) return;

    switch (phase) {

      // ── Ăn Trộm: đổi role với người khác ──
      case NIGHT_PHASES.THIEF: {
        if (player.role !== ROLES.THIEF || s.thiefDone) return;
        const target = s.players[action.targetId];
        if (!target || !target.alive || target.id === socketId) return;

        // Lưu role cũ
        const stolenRole   = target.role;
        const thiefOldRole = player.role;

        // Đổi role
        player.role = stolenRole;
        target.role = ROLES.VILLAGER; // người bị trộm thành Dân
        s.thiefDone = true;

        // Thông báo Ăn Trộm
        const newPayload = { newRole: stolenRole };
        if (isWerewolf(stolenRole)) {
          newPayload.wolfPack = this.getAliveWolves()
            .filter(w => w.id !== socketId)
            .map(w => ({ id: w.id, name: w.name, role: w.role }));
          // Thông báo bầy Sói
          this.getAliveWolves().filter(w => w.id !== socketId).forEach(w => {
            this.emitTo(w.id, 'game:wolf_pack_update', { newWolf: { id: socketId, name: player.name } });
          });
        }
        this.emitTo(socketId, 'night:thief_result', newPayload);

        // Thông báo người bị trộm
        this.emitTo(target.id, 'night:thief_victim', {
          message: 'Ăn Trộm đã lấy role của bạn! Bạn trở thành Dân Thường.',
          newRole:  ROLES.VILLAGER,
        });
        break;
      }

      // ── Ma Sói vote ai chết ───────────────
      case NIGHT_PHASES.WEREWOLF: {
        if (!isWerewolf(player.role) || player.role === ROLES.WOLF_CUB) return;
        if (!s.nightActions.wolfVotes) s.nightActions.wolfVotes = {};
        s.nightActions.wolfVotes[socketId] = action.targetId;
        // Broadcast cho cả bầy
        this.getAliveWolves().filter(w => w.role !== ROLES.WOLF_CUB).forEach(w => {
          this.emitTo(w.id, 'night:wolf_vote_update', {
            voterId:   socketId,
            voterName: player.name,
            targetId:  action.targetId,
          });
        });
        break;
      }

      // ── Bảo Vệ ───────────────────────────
      case NIGHT_PHASES.GUARD: {
        if (player.role !== ROLES.GUARD) return;
        s.nightActions.guardTarget = action.targetId;
        s.guardLastTarget          = action.targetId;
        break;
      }

      // ── Phù Thủy ─────────────────────────
      case NIGHT_PHASES.WITCH: {
        if (player.role !== ROLES.WITCH) return;
        if (action.save && s.witchPotions.save) {
          s.nightActions.witchSave = s.killedByWolf;
          s.witchPotions.save      = false;
        }
        if (action.poisonTarget && s.witchPotions.poison) {
          s.nightActions.witchPoison = action.poisonTarget;
          s.witchPotions.poison      = false;
        }
        break;
      }

      // ── Tiên Tri ─────────────────────────
      case NIGHT_PHASES.SEER: {
        if (player.role !== ROLES.SEER || s.round === 1) return;
        const target = s.players[action.targetId];
        if (!target) return;
        this.emitTo(socketId, 'night:seer_result', {
          targetId:   action.targetId,
          targetName: target.name,
          result:     isWerewolf(target.role) ? 'wolf' : 'not_wolf',
        });
        break;
      }

      // ── Cupid ghép đôi ───────────────────
      case NIGHT_PHASES.CUPID: {
        if (player.role !== ROLES.CUPID) return;
        const { lover1, lover2 } = action;
        if (!lover1 || !lover2 || lover1 === lover2) return;
        if (s.lovers) return; // đã ghép rồi
        const p1 = s.players[lover1];
        const p2 = s.players[lover2];
        if (!p1 || !p2 || !p1.alive || !p2.alive) return;

        p1.isLover = true; p1.loverId = lover2;
        p2.isLover = true; p2.loverId = lover1;
        s.lovers   = [lover1, lover2];

        // Xác định phe cặp đôi:
        // - Ít nhất 1 người là Sói → phe Lovers (phe thứ ba)
        // - Cả 2 đều Dân → thắng cùng Dân (loverTeam = village)
        const anyWolf = isWerewolf(p1.role) || isWerewolf(p2.role);
        s.loverTeam   = anyWolf ? TEAMS.LOVERS : TEAMS.VILLAGE;
        p1.loverTeam  = s.loverTeam;
        p2.loverTeam  = s.loverTeam;

        // Hai người yêu thấy role nhau, KHÔNG biết ai là Cupid
        this.emitTo(lover1, 'night:cupid_result', {
          loverId:    lover2,
          loverName:  p2.name,
          loverRole:  p2.role,
          loverTeam:  s.loverTeam,
        });
        this.emitTo(lover2, 'night:cupid_result', {
          loverId:    lover1,
          loverName:  p1.name,
          loverRole:  p1.role,
          loverTeam:  s.loverTeam,
        });
        break;
      }

      // ── Sói Trắng giết Sói khác ──────────
      case NIGHT_PHASES.WHITE_WOLF: {
        if (player.role !== ROLES.WHITE_WOLF) return;
        const cycleOk = (s.round - s.whiteWolfLastKill) >= 2;
        if (!cycleOk) return;
        const target = s.players[action.targetId];
        if (!target || !target.alive) return;
        if (!isWerewolf(target.role) || target.id === socketId) return;
        s.nightActions.whiteWolfTarget = action.targetId;
        s.whiteWolfLastKill            = s.round;
        break;
      }

      // ── Sói Đen convert người ────────────
      case NIGHT_PHASES.BLACK_WOLF: {
        if (player.role !== ROLES.BLACK_WOLF || s.blackWolfConverted) return;
        const target = s.players[action.targetId];
        const noConvert = [ROLES.WHITE_WOLF, ROLES.BLACK_WOLF, ROLES.FOOL, ROLES.ARSONIST];
        if (!target || !target.alive || isWerewolf(target.role) || noConvert.includes(target.role)) return;

        // Convert người đó thành Sói
        target.role = ROLES.WEREWOLF;
        s.blackWolfConverted = true;

        // Thông báo người bị convert
        const wolves = this.getAliveWolves()
          .filter(w => w.id !== target.id)
          .map(w => ({ id: w.id, name: w.name, role: w.role }));
        this.emitTo(target.id, 'night:black_wolf_converted', {
          newRole:  ROLES.WEREWOLF,
          wolfPack: wolves,
        });

        // Thông báo bầy Sói
        this.getAliveWolves().filter(w => w.id !== target.id).forEach(w => {
          this.emitTo(w.id, 'game:wolf_pack_update', { newWolf: { id: target.id, name: target.name } });
        });
        break;
      }

      // ── Kẻ Phóng Hỏa ─────────────────────
      case NIGHT_PHASES.ARSONIST: {
        if (player.role !== ROLES.ARSONIST) return;

        if (action.mode === 'oil') {
          // Tẩm xăng tối đa 2 người mỗi đêm
          const targets = Array.isArray(action.targets) ? action.targets.slice(0, 2) : [];
          targets.forEach(id => {
            const t = s.players[id];
            if (t && t.alive && id !== socketId) s.oiledPlayers.add(id);
          });
          this.emitTo(socketId, 'night:arsonist_oiled', {
            oiledCount: s.oiledPlayers.size,
          });
        } else if (action.mode === 'burn') {
          // Đốt tất cả người bị tẩm xăng
          if (s.oiledPlayers.size > 0) {
            s.nightActions.arsonistBurn = [...s.oiledPlayers];
            s.oiledPlayers.clear();
          }
        }
        break;
      }
    }
  }

  // ════════════════════════════════════════
  // GIẢI QUYẾT ĐÊM
  // ════════════════════════════════════════
  _resolveNight() {
    const s      = this.state;
    const deaths = [];

    // 1. Tính nạn nhân Sói — hoà phiếu → không ai chết
    if (s.nightActions.wolfVotes) {
      const votes  = Object.values(s.nightActions.wolfVotes);
      const tally  = {};
      votes.forEach(v => { tally[v] = (tally[v] || 0) + 1; });

      if (Object.keys(tally).length > 0) {
        const maxV  = Math.max(...Object.values(tally));
        const cands = Object.keys(tally).filter(k => tally[k] === maxV);

        if (cands.length === 1) {
          // Đa số rõ ràng
          s.killedByWolf = cands[0];

          // Cắn 2 người (Sói Con chết đêm trước)
          if (s.doubleBiteNext) {
            // Chọn thêm 1 nạn nhân ngẫu nhiên trong dân còn sống
            const extras = this.getAliveVillagers()
              .filter(p => p.id !== s.killedByWolf);
            if (extras.length > 0) {
              const second = extras[Math.floor(Math.random() * extras.length)];
              deaths.push({ id: second.id, cause: 'wolf' });
            }
            s.doubleBiteNext = false;
          }
        }
        // Hoà → s.killedByWolf vẫn null, không ai chết vì Sói
      }
    }

    // 2. Nửa Người Nửa Sói bị cắn → biến thành Sói, không chết
    if (s.killedByWolf) {
      const v = s.players[s.killedByWolf];
      if (v && v.role === ROLES.HALF_WOLF) {
        v.role         = ROLES.WEREWOLF;
        s.killedByWolf = null;
        this.emitTo(v.id, 'game:half_wolf_transformed', { newRole: ROLES.WEREWOLF });
        // Thông báo bầy Sói
        this.getAliveWolves().filter(w => w.id !== v.id).forEach(w => {
          this.emitTo(w.id, 'game:wolf_pack_update', { newWolf: { id: v.id, name: v.name } });
        });
      }
    }

    // 3. Bảo Vệ cứu (không chặn được arsonist)
    if (s.killedByWolf && s.nightActions.guardTarget === s.killedByWolf) {
      s.killedByWolf = null;
    }

    // 4. Phù Thủy cứu
    if (s.killedByWolf && s.nightActions.witchSave === s.killedByWolf) {
      s.killedByWolf = null;
    }

    // 5. Thêm nạn nhân chính vào danh sách
    if (s.killedByWolf) deaths.push({ id: s.killedByWolf, cause: 'wolf' });

    // 6. Phù Thủy độc
    if (s.nightActions.witchPoison) {
      deaths.push({ id: s.nightActions.witchPoison, cause: 'poison' });
    }

    // 7. Sói Trắng giết Sói
    if (s.nightActions.whiteWolfTarget) {
      deaths.push({ id: s.nightActions.whiteWolfTarget, cause: 'white_wolf' });
    }

    // 8. Kẻ Phóng Hỏa đốt — xuyên bảo vệ
    if (s.nightActions.arsonistBurn && s.nightActions.arsonistBurn.length > 0) {
      s.nightActions.arsonistBurn.forEach(id => {
        deaths.push({ id, cause: 'arsonist', bypassGuard: true });
      });
    }

    // Áp dụng tất cả cái chết (bao gồm chain cặp đôi)
    const actualDeaths = this._applyDeaths(deaths);

    // Thợ Săn chết đêm → cho bắn trước khi công bố
    const deadHunter = actualDeaths.find(d => {
      const p = s.players[d.id];
      return p && p.role === ROLES.HUNTER;
    });
    if (deadHunter) {
      this._triggerHunter(deadHunter.id, () => this._announceNightDeaths(actualDeaths));
      return;
    }

    this._announceNightDeaths(actualDeaths);
  }

  // ── Áp dụng danh sách cái chết (có chain cặp đôi) ──
  _applyDeaths(deathList) {
    const s       = this.state;
    const actual  = [];
    const visited = new Set();

    const killOne = (id, cause, bypassGuard = false) => {
      if (visited.has(id)) return;
      visited.add(id);
      const p = s.players[id];
      if (!p || !p.alive) return;

      // Già Làng: 2 mạng khi bị Sói cắn, chết ngay với cause khác
      if (p.role === ROLES.ELDER && !s.elderDead) {
        const wolfCauses = ['wolf', 'white_wolf'];
        if (wolfCauses.includes(cause)) {
          if (s.elderLives > 1) {
            s.elderLives--;
            this.emit('game:elder_survived', { playerId: id, livesLeft: s.elderLives });
            return; // Không chết lần này
          }
        }
        // Bị treo, poison, hunter, arsonist → chết ngay + kỹ năng đặc biệt mất
      }

      p.alive = false;
      actual.push({ id: p.id, name: p.name, role: p.role, cause });

      // Già Làng chết → mất kỹ năng đặc biệt (trừ Thợ Săn)
      if (p.role === ROLES.ELDER) {
        s.elderDead = true;
        // Thông báo tất cả: kỹ năng đặc biệt bị vô hiệu
        this.emit('game:elder_died', { playerId: id });
      }

      if (p.role === ROLES.WOLF_CUB) s.wolfCubDied = true;

      // Chain cặp đôi
      if (p.isLover && p.loverId) {
        const lover = s.players[p.loverId];
        if (lover && lover.alive) {
          killOne(lover.id, 'heartbreak');
        }
      }
    };

    const seen = new Set();
    for (const d of deathList) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      killOne(d.id, d.cause, d.bypassGuard || false);
    }

    return actual;
  }

  _triggerHunter(hunterId, callback) {
    const alive = this.getAlivePlayers().filter(p => p.id !== hunterId);
    this.emitTo(hunterId, 'game:hunter_action', {
      targets:  alive.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
      duration: DURATION.HUNTER_SHOOT,
    });
    this._hunterTimer = this._setTimeout(callback, DURATION.HUNTER_SHOOT);
  }

  handleHunterShoot(hunterId, targetId) {
    const s      = this.state;
    const hunter = s.players[hunterId];
    const target = s.players[targetId];
    if (!hunter || !target || !target.alive) return;

    // Xoá timer hunter để không callback 2 lần
    clearTimeout(this._hunterTimer);

    const shot = this._applyDeaths([{ id: targetId, cause: 'hunter_shot' }]);
    this.emit('game:hunter_shot', {
      hunterId,
      hunterName: hunter.name,
      deaths:     shot.map(d => ({ id: d.id, name: d.name, role: d.role, cause: d.cause })),
    });

    // Tiếp tục flow
    if (s.phase === 'night' || [
      'night_werewolf','night_guard','night_witch','night_seer',
      'night_cupid','night_thief','night_white_wolf',
    ].includes(s.phase)) {
      this._announceNightDeaths(this.state._pendingNightDeaths || []);
    } else {
      this._afterVoteDeaths(this.state._pendingVoteDeaths || []);
    }
  }

  _announceNightDeaths(deaths) {
    this.state._pendingNightDeaths = null;
    this.emit('game:night_result', {
      deaths:  deaths.map(d => ({ id: d.id, name: d.name, role: d.role, cause: d.cause })),
      players: this.getPublicPlayers(),
    });

    const win = this._checkWin();
    if (win) {
      this._setTimeout(() => this._endGame(win), DURATION.SHOW_RESULT);
      return;
    }
    this._setTimeout(() => this._startDay(), DURATION.SHOW_RESULT);
  }

  // ════════════════════════════════════════
  // NGÀY
  // ════════════════════════════════════════
  _startDay() {
    this.state.phase = 'day_chat';
    this.emit('game:day_start', {
      round:        this.state.round,
      players:      this.getPublicPlayers(),
      chatDuration: DURATION.DAY_CHAT,
      voteDuration: DURATION.DAY_VOTE,
    });
    this._setTimeout(() => this._startVoting(), DURATION.DAY_CHAT);
  }

  _startVoting() {
    this.state.phase  = 'day_vote';
    this.state.voting = this._initVoting();
    this.emit('game:vote_start', {
      players:  this.getPublicPlayers(),
      duration: DURATION.DAY_VOTE,
    });
    this._voteTimer = this._setTimeout(() => this._endVoting(), DURATION.DAY_VOTE);
  }

  handleVote(socketId, targetId) {
    const s = this.state;
    if (s.phase !== 'day_vote' || !s.voting) return;
    const voter = s.players[socketId];
    if (!voter || !voter.alive) return;

    s.voting.votes[socketId] = targetId;

    this.emit('game:vote_update', {
      voterId:    socketId,
      targetId,
      votedCount: Object.keys(s.voting.votes).length,
      totalAlive: this.getAlivePlayers().length,
    });

    // Tất cả đã vote → kết thúc sớm
    if (Object.keys(s.voting.votes).length >= this.getAlivePlayers().length) {
      clearTimeout(this._voteTimer);
      this._setTimeout(() => this._endVoting(), 800);
    }
  }

  _endVoting() {
    const s = this.state;
    if (!s.voting) return;
    s.phase = 'vote_result';

    const result  = this._tallyVotes();
    const summary = this._voteSummary();

    this.emit('game:vote_result', {
      tally:    result.tally,
      summary,
      executed: result.executed,
      tied:     result.tied,
      skipWon:  result.skipWon,
    });

    // Thực thi án tử — kiểm tra Thằng Ngốc
    const execIds = Array.isArray(result.executed)
      ? result.executed
      : (result.executed && result.executed !== 'skip' ? [result.executed] : []);

    // Kiểm tra Thằng Ngốc trong danh sách bị treo
    const foolId = execIds.find(id => {
      const p = s.players[id];
      return p && p.alive && p.role === ROLES.FOOL && !s.foolRevealed;
    });

    if (foolId) {
      // Thằng Ngốc lộ role, không chết, vote lại
      s.foolRevealed = true;
      const fool = s.players[foolId];
      // Nếu là Sheriff → vote chỉ còn 1 phiếu
      if (fool.isSheriff) fool.isSheriff = false;

      this.emit('game:fool_revealed', {
        foolId,
        foolName: fool.name,
        players:  this.getPublicPlayers(),
      });

      // Reset vote và bắt đầu lại sau 5 giây
      s.voting = null;
      this._setTimeout(() => this._startVoting(), 5000);
      return;
    }

    const rawDeaths = execIds
      .filter(id => s.players[id]?.alive)
      .map(id => ({ id, cause: 'vote' }));

    const deaths = this._applyDeaths(rawDeaths);

    // Sheriff bị treo → chọn kế nhiệm
    const deadSheriff = deaths.find(d => {
      const p = s.players[d.id];
      return p && p.isSheriff === false && d.cause === 'vote';
    });
    // (isSheriff đã bị set false bởi _applyDeaths → cần check trước khi apply)
    // Sửa: check trong execIds trực tiếp
    execIds.forEach(id => {
      const p = s.players[id];
      if (p && p.isSheriff) {
        p.isSheriff = false;
        const candidates = this.getAlivePlayers().map(q => ({ id: q.id, name: q.name }));
        this.emitTo(id, 'game:sheriff_succession', { candidates });
      }
    });

    s._pendingVoteDeaths = deaths;

    // Thợ Săn bị treo?
    const deadHunter = deaths.find(d => {
      const p = s.players[d.id];
      return p && p.role === ROLES.HUNTER;
    });

    this._setTimeout(() => {
      if (deadHunter) {
        this._triggerHunter(deadHunter.id, () => this._afterVoteDeaths(deaths));
        return;
      }
      this._afterVoteDeaths(deaths);
    }, DURATION.VOTE_RESULT);
  }

  _afterVoteDeaths(deaths) {
    this.state._pendingVoteDeaths = null;
    const win = this._checkWin();
    if (win) { this._endGame(win); return; }

    this.emit('game:players_update', {
      players:      this.getPublicPlayers(),
      recentDeaths: deaths,
    });
    this._setTimeout(() => this._startNight(), 2000);
  }

  handleSheriffSuccession(currentSheriffId, newSheriffId) {
    const s      = this.state;
    const newShf = s.players[newSheriffId];
    if (!newShf || !newShf.alive) return;
    Object.values(s.players).forEach(p => { p.isSheriff = false; });
    newShf.isSheriff = true;
    this.emit('game:sheriff_changed', {
      newSheriffId,
      newSheriffName: newShf.name,
    });
  }

  // ════════════════════════════════════════
  // VOTE HELPERS
  // ════════════════════════════════════════
  _initVoting() {
    return { votes: {}, startTime: Date.now() };
  }

  _tallyVotes() {
    const s         = this.state;
    const tally     = {};
    let   skipCount = 0;

    for (const [voterId, targetId] of Object.entries(s.voting.votes)) {
      const voter = s.players[voterId];
      if (!voter || !voter.alive) continue;
      if (targetId === 'skip') { skipCount++; continue; }
      const w = voter.isSheriff ? 2 : 1;
      tally[targetId] = (tally[targetId] || 0) + w;
    }

    if (skipCount > 0) tally['skip'] = skipCount;

    if (Object.keys(tally).length === 0) {
      return { executed: null, tally, tied: false, skipWon: true };
    }

    const maxVal  = Math.max(...Object.values(tally));
    const topKeys = Object.keys(tally).filter(k => tally[k] === maxVal);

    if (topKeys.includes('skip')) {
      return { executed: null, tally, tied: false, skipWon: true };
    }
    if (topKeys.length > 1) {
      if (this.room.settings.tieKillAll) {
        return { executed: topKeys, tally, tied: true, skipWon: false };
      }
      return { executed: null, tally, tied: true, skipWon: false };
    }

    return { executed: topKeys[0], tally, tied: false, skipWon: false };
  }

  _voteSummary() {
    const s       = this.state;
    const summary = {};
    for (const [voterId, targetId] of Object.entries(s.voting.votes)) {
      const voter = s.players[voterId];
      if (!voter) continue;
      if (!summary[targetId]) summary[targetId] = [];
      summary[targetId].push({
        id:     voterId,
        name:   voter.name,
        weight: voter.isSheriff ? 2 : 1,
      });
    }
    return summary;
  }

  // ════════════════════════════════════════
  // ĐIỀU KIỆN THẮNG
  // ════════════════════════════════════════
  _checkWin() {
    const s         = this.state;
    const alive     = this.getAlivePlayers();
    const wolves    = this.getAliveWolves();
    const nonWolves = alive.filter(p => !isWerewolf(p.role));

    // Sói Trắng solo: còn sống 1 mình cuối cùng
    if (alive.length === 1 && alive[0].role === ROLES.WHITE_WOLF) {
      return {
        winner:     TEAMS.SOLO,
        winnerRole: ROLES.WHITE_WOLF,
        message:    '🤍 Sói Trắng thắng! Kẻ bí ẩn tồn tại đến cùng!',
      };
    }

    // Cặp đôi phe thứ ba: cả 2 sống, chỉ còn 2 người cuối
    if (s.lovers && s.loverTeam === TEAMS.LOVERS) {
      const [l1id, l2id] = s.lovers;
      const l1 = s.players[l1id];
      const l2 = s.players[l2id];
      if (l1?.alive && l2?.alive && alive.length === 2) {
        return {
          winner:  TEAMS.LOVERS,
          message: `💘 ${l1.name} & ${l2.name} thắng! Tình yêu chiến thắng tất cả!`,
        };
      }
    }

    // Tất cả Sói chết → Dân thắng
    if (wolves.length === 0) {
      return {
        winner:  TEAMS.VILLAGE,
        message: '🌻 Dân Làng thắng! Tất cả Ma Sói đã bị tiêu diệt!',
      };
    }

    // Sói >= Dân còn sống → Sói thắng
    if (wolves.length >= nonWolves.length) {
      return {
        winner:  TEAMS.WEREWOLF,
        message: '🐺 Ma Sói thắng! Bóng tối đã nuốt chửng ngôi làng!',
      };
    }

    return null;
  }

  // ════════════════════════════════════════
  // KẾT THÚC GAME
  // ════════════════════════════════════════
  _endGame(win) {
    this.clearTimers();
    this.state.phase = 'game_over';

    const revealedPlayers = Object.values(this.state.players).map(p => ({
      id:           p.id,
      name:         p.name,
      avatar:       p.avatar,
      role:         p.role,
      originalRole: p.originalRole,
      alive:        p.alive,
      isSheriff:    p.isSheriff,
      isLover:      p.isLover,
    }));

    this.emit('game:over', { ...win, players: revealedPlayers });
    this.room.gameState = null;
    console.log(`[game] Phòng ${this.code} kết thúc — ${win.message}`);
  }
}

module.exports = { GameLoop };
