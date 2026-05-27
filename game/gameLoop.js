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
    };

    let isReal;
    if (phase === NIGHT_PHASES.WEREWOLF) {
      isReal = this.getAliveWolves().filter(w => w.role !== ROLES.WOLF_CUB).length > 0;
    } else if (phase === NIGHT_PHASES.WHITE_WOLF) {
      // Thật khi Sói Trắng còn sống VÀ đúng chu kỳ 2 đêm
      const ww = this.hasRoleAlive(ROLES.WHITE_WOLF);
      const cycleOk = (this.state.round - this.state.whiteWolfLastKill) >= 2;
      isReal = ww && cycleOk;
    } else if (phase === NIGHT_PHASES.THIEF) {
      isReal = !this.state.thiefDone && this.hasRoleAlive(ROLES.THIEF);
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

    // 3. Bảo Vệ cứu
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

    // Áp dụng tất cả cái chết (bao gồm chain cặp đôi)
    const actualDeaths = this._applyDeaths(deaths);

    // Thợ Săn chết đêm → cho bắn trước khi công bố
    const deadHunter = actualDeaths.find(d => {
      const p = s.players[d.id];
      
