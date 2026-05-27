// game/gameLoop.js
// Vòng lặp game chính: đêm/ngày, phase, xử lý hành động, điều kiện thắng

const {
  ROLES, TEAMS, NIGHT_PHASES,
  isWerewolf, buildRoleList, buildNightQueue,
  getAlivePlayers, getAliveWolves, getAliveVillagers,
  isRoleAlive,
} = require('../roles/index');

// ─── Thời gian (ms) ──────────────────────────
const DURATION = {
  DAY_CHAT:    30_000,
  DAY_VOTE:    90_000,
  VOTE_RESULT:  5_000,
  NIGHT_ACTION: 30_000,
  NIGHT_FAKE_MIN: 5_000,
  NIGHT_FAKE_MAX: 10_000,
  SHERIFF_VOTE: 30_000,
  HUNTER_SHOOT: 15_000,
  SHOW_RESULT:   4_000,
};

// ─────────────────────────────────────────────
class GameLoop {
  constructor(room, io) {
    this.room   = room;
    this.io     = io;
    this.code   = room.code;
    this.state  = null;
    this._timers = [];
  }

  // ── Emit helpers ─────────────────────────
  emit(event, data)               { this.io.to(this.code).emit(event, data); }
  emitTo(socketId, event, data)   { this.io.to(socketId).emit(event, data); }

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

    // Khởi tạo state
    const gamePlayers = {};
    shuffledPlayers.forEach((p, i) => {
      gamePlayers[p.id] = {
        id:         p.id,
        name:       p.name,
        avatar:     p.avatar,
        role:       shuffledRoles[i] || ROLES.VILLAGER,
        alive:      true,
        isSheriff:  false,
        isLover:    false,
        loverId:    null,
        loverTeam:  null,
      };
    });

    this.state = {
      phase:            'lobby',
      round:            0,
      players:          gamePlayers,
      // Đêm
      nightActions:     {},
      killedByWolf:     null,
      killedThisNight:  [],
      guardLastTarget:  null,
      witchPotions:     { save: true, poison: true },
      wolfCubDied:      false,
      doubleBiteNext:   false,
      whiteWolfLastKill: 0,
      // Cặp đôi
      lovers:           null,   // [id1, id2]
      loverTeam:        null,
      // Thief
      thiefExtraRoles:  thiefExtraRoles || [],
      // Vote
      voting:           null,
      // Misc
      sheriffElected:   false,
    };

    this.room.gameState = this.state;

    // Gửi role cho từng người
    Object.values(gamePlayers).forEach(p => {
      const payload = { role: p.role };
      if (isWerewolf(p.role)) {
        payload.wolfPack = Object.values(gamePlayers)
          .filter(x => isWerewolf(x.role) && x.id !== p.id)
          .map(x => ({ id: x.id, name: x.name, role: x.role }));
      }
      this.emitTo(p.id, 'game:role_assigned', payload);
    });

    this.emit('game:started', { players: this.getPublicPlayers() });

    // Bắt đầu: bầu Cảnh Sát Trưởng → rồi vào đêm 1
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

    this._setTimeout(() => this._endSheriffElection(), DURATION.SHERIFF_VOTE);
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
  }

  _endSheriffElection() {
    const result = this._tallyVotes();
    if (result.executed && !Array.isArray(result.executed) && result.executed !== 'skip') {
      const p = this.getPlayer(result.executed);
      if (p) { p.isSheriff = true; this.state.sheriffElected = true; }
    }

    const sheriff = Object.values(this.state.players).find(p => p.isSheriff);
    this.emit('game:sheriff_result', {
      sheriffId:   sheriff?.id || null,
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
    this.state.phase          = 'night';
    this.state.killedByWolf   = null;
    this.state.killedThisNight = [];
    this.state.nightActions   = {};

    // Sói Con chết đêm trước → đêm này cắn 2 người
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
    clearTimeout(this._currentPhaseTimer);

    // Xác định phase có thật không
    const phaseRoleMap = {
      [NIGHT_PHASES.CUPID]:    ROLES.CUPID,
      [NIGHT_PHASES.THIEF]:    ROLES.THIEF,
      [NIGHT_PHASES.GUARD]:    ROLES.GUARD,
      [NIGHT_PHASES.WITCH]:    ROLES.WITCH,
      [NIGHT_PHASES.SEER]:     ROLES.SEER,
      [NIGHT_PHASES.WEREWOLF]: null,
    };

    const requiredRole = phaseRoleMap[phase];
    const isReal = phase === NIGHT_PHASES.WEREWOLF
      ? this.getAliveWolves().length > 0
      : (requiredRole ? this.hasRoleAlive(requiredRole) : true);

    const duration = isReal
      ? DURATION.NIGHT_ACTION
      : (DURATION.NIGHT_FAKE_MIN + Math.floor(Math.random() * (DURATION.NIGHT_FAKE_MAX - DURATION.NIGHT_FAKE_MIN)));

    // Thông báo cho tất cả
    this.emit('game:night_phase', { phase, duration, isFake: !isReal });

    // Gửi UI hành động cho role liên quan
    if (isReal) this._sendNightActionUI(phase);

    this._currentPhaseTimer = this._setTimeout(onDone, duration);
  }

  _sendNightActionUI(phase) {
    const s     = this.state;
    const alive = this.getAlivePlayers();

    switch (phase) {

      case NIGHT_PHASES.WEREWOLF: {
        const wolves   = this.getAliveWolves();
        const targets  = alive.filter(p => !isWerewolf(p.role))
                              .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        wolves.forEach(w => {
          this.emitTo(w.id, 'night:werewolf_action', {
            targets,
            doubleBite: s.doubleBiteNext,
            wolfPack:   wolves.map(x => ({ id: x.id, name: x.name })),
          });
        });
        break;
      }

      case NIGHT_PHASES.GUARD: {
        const guard = alive.find(p => p.role === ROLES.GUARD);
        if (!guard) break;
        const targets = alive
          .filter(p => p.id !== s.guardLastTarget)
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(guard.id, 'night:guard_action', { targets });
        break;
      }

      case NIGHT_PHASES.WITCH: {
        const witch = alive.find(p => p.role === ROLES.WITCH);
        if (!witch) break;
        const poisonTargets = alive
          .filter(p => p.id !== s.killedByWolf)
          .map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        this.emitTo(witch.id, 'night:witch_action', {
          killedId:       s.killedByWolf,
          killedName:     s.killedByWolf ? s.players[s.killedByWolf]?.name : null,
          potions:        s.witchPotions,
          canSelfSave:    this.room.settings.witchSelfSave,
          poisonTargets,
        });
        break;
      }

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

      case NIGHT_PHASES.CUPID: {
        const cupid = alive.find(p => p.role === ROLES.CUPID);
        if (!cupid) break;
        this.emitTo(cupid.id, 'night:cupid_action', {
          targets: alive.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
        });
        break;
      }

      case NIGHT_PHASES.THIEF: {
        const thief = alive.find(p => p.role === ROLES.THIEF);
        if (!thief || s.thiefExtraRoles.length === 0) break;
        this.emitTo(thief.id, 'night:thief_action', { roles: s.thiefExtraRoles });
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

      case NIGHT_PHASES.WEREWOLF: {
        if (!isWerewolf(player.role)) return;
        if (!s.nightActions.wolfVotes) s.nightActions.wolfVotes = {};
        s.nightActions.wolfVotes[socketId] = action.targetId;
        // Cập nhật cho cả bầy
        this.getAliveWolves().forEach(w => {
          this.emitTo(w.id, 'night:wolf_vote_update', {
            voterId:    socketId,
            voterName:  player.name,
            targetId:   action.targetId,
          });
        });
        break;
      }

      case NIGHT_PHASES.GUARD: {
        if (player.role !== ROLES.GUARD) return;
        s.nightActions.guardTarget = action.targetId;
        s.guardLastTarget          = action.targetId;
        break;
      }

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

      case NIGHT_PHASES.SEER: {
        if (player.role !== ROLES.SEER) return;
        const target = s.players[action.targetId];
        if (!target) return;
        const result = isWerewolf(target.role) ? 'wolf' : 'not_wolf';
        this.emitTo(socketId, 'night:seer_result', {
          targetId:   action.targetId,
          targetName: target.name,
          result,
        });
        break;
      }

      case NIGHT_PHASES.CUPID: {
        if (player.role !== ROLES.CUPID) return;
        const { lover1, lover2 } = action;
        if (!lover1 || !lover2 || lover1 === lover2) return;
        const p1 = s.players[lover1];
        const p2 = s.players[lover2];
        if (!p1 || !p2) return;

        p1.isLover = true; p1.loverId = lover2;
        p2.isLover = true; p2.loverId = lover1;
        s.lovers = [lover1, lover2];

        // Xác định phe cặp đôi
        const bothWolf = isWerewolf(p1.role) && isWerewolf(p2.role);
        const mixedTeam = isWerewolf(p1.role) !== isWerewolf(p2.role);
        s.loverTeam = mixedTeam ? TEAMS.LOVERS : (bothWolf ? TEAMS.WEREWOLF : TEAMS.VILLAGE);
        p1.loverTeam = s.loverTeam;
        p2.loverTeam = s.loverTeam;

        this.emitTo(lover1, 'night:cupid_result', { loverId: lover2, loverName: p2.name, loverRole: p2.role, loverTeam: s.loverTeam });
        this.emitTo(lover2, 'night:cupid_result', { loverId: lover1, loverName: p1.name, loverRole: p1.role, loverTeam: s.loverTeam });
        break;
      }

      case NIGHT_PHASES.THIEF: {
        if (player.role !== ROLES.THIEF) return;
        const chosen = action.role;
        if (!s.thiefExtraRoles.includes(chosen)) return;
        // Nếu có Sói trong extra, bắt buộc phải chọn Sói
        const hasWolfInExtra = s.thiefExtraRoles.some(r => isWerewolf(r));
        if (hasWolfInExtra && !isWerewolf(chosen)) return;
        player.role = chosen;
        this.emitTo(socketId, 'night:thief_result', { newRole: chosen });
        if (isWerewolf(chosen)) {
          // Cho Thief biết bầy Sói
          const wolfPack = this.getAliveWolves()
            .filter(w => w.id !== socketId)
            .map(w => ({ id: w.id, name: w.name, role: w.role }));
          this.emitTo(socketId, 'night:wolf_pack_info', { wolfPack });
          // Thông báo cho Sói cũ
          this.getAliveWolves().filter(w => w.id !== socketId).forEach(w => {
            this.emitTo(w.id, 'game:wolf_pack_update', { newWolf: { id: socketId, name: player.name } });
          });
        }
        break;
      }

      case 'night_white_wolf': {
        if (player.role !== ROLES.WHITE_WOLF) return;
        // Chỉ được dùng mỗi 2 đêm
        if (s.round - s.whiteWolfLastKill < 2) return;
        const target = s.players[action.targetId];
        if (!target || !target.alive || !isWerewolf(target.role) || target.id === socketId) return;
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

    // 1. Xác định nạn nhân Sói
    if (s.nightActions.wolfVotes) {
      const votes   = Object.values(s.nightActions.wolfVotes);
      const tally   = {};
      votes.forEach(v => tally[v] = (tally[v] || 0) + 1);
      const maxV    = Math.max(...Object.values(tally));
      const cands   = Object.keys(tally).filter(k => tally[k] === maxV);
      const victim  = cands[Math.floor(Math.random() * cands.length)];
      s.killedByWolf = victim;

      // Cắn 2: chọn nạn nhân thứ 2 nếu doubleBite
      if (s.doubleBiteNext && cands.length >= 2) {
        const second = cands.find(c => c !== victim);
        if (second) deaths.push({ id: second, cause: 'wolf' });
        s.doubleBiteNext = false;
      }
    }

    // 2. Nửa Người Nửa Sói bị cắn → biến thành Sói
    if (s.killedByWolf) {
      const v = s.players[s.killedByWolf];
      if (v && v.role === ROLES.HALF_WOLF) {
        v.role         = ROLES.WEREWOLF;
        s.killedByWolf = null;
        this.emitTo(v.id, 'game:half_wolf_transformed', {});
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

    // 5. Thêm nạn nhân chính
    if (s.killedByWolf) deaths.push({ id: s.killedByWolf, cause: 'wolf' });

    // 6. Phù Thủy độc
    if (s.nightActions.witchPoison) deaths.push({ id: s.nightActions.witchPoison, cause: 'poison' });

    // 7. Sói Trắng giết Sói khác
    if (s.nightActions.whiteWolfTarget) deaths.push({ id: s.nightActions.whiteWolfTarget, cause: 'white_wolf' });

    // Áp dụng cái chết
    const actualDeaths = this._applyDeaths(deaths);

    // Thợ Săn chết đêm?
    const deadHunter = actualDeaths.find(d => s.players[d.id]?.role === ROLES.HUNTER);
    if (deadHunter) {
      this._triggerHunter(deadHunter.id, () => this._announceNightDeaths(actualDeaths));
      return;
    }

    this._announceNightDeaths(actualDeaths);
  }

  _applyDeaths(deathList) {
    const s      = this.state;
    const actual = [];

    for (const d of deathList) {
      const p = s.players[d.id];
      if (!p || !p.alive) continue;
      p.alive = false;
      actual.push({ id: d.id, name: p.name, role: p.role, cause: d.cause });

      if (p.role === ROLES.WOLF_CUB) s.wolfCubDied = true;

      // Cặp đôi: một chết kéo người kia
      if (p.isLover && p.loverId) {
        const lover = s.players[p.loverId];
        if (lover && lover.alive) {
          lover.alive = false;
          actual.push({ id: lover.id, name: lover.name, role: lover.role, cause: 'heartbreak' });
          if (lover.role === ROLES.WOLF_CUB) s.wolfCubDied = true;
        }
      }
    }

    return actual;
  }

  _triggerHunter(hunterId, callback) {
    const alive = this.getAlivePlayers().filter(p => p.id !== hunterId);
    this.emitTo(hunterId, 'game:hunter_action', {
      targets:  alive.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
      duration: DURATION.HUNTER_SHOOT,
    });
    this._setTimeout(callback, DURATION.HUNTER_SHOOT);
  }

  handleHunterShoot(hunterId, targetId) {
    const hunter = this.state.players[hunterId];
    const target = this.state.players[targetId];
    if (!hunter || !target || target.alive === false) return;
    target.alive = false;
    this.emit('game:hunter_shot', {
      hunterId,
      hunterName: hunter.name,
      targetId,
      targetName: target.name,
      role:       target.role,
    });
    if (target.isLover && target.loverId) {
      const lover = this.state.players[target.loverId];
      if (lover && lover.alive) {
        lover.alive = false;
        this.emit('game:hunter_shot', {
          hunterId,
          hunterName: hunter.name,
          targetId:   lover.id,
          targetName: lover.name,
          role:       lover.role,
          cause:      'heartbreak',
        });
      }
    }
  }

  _announceNightDeaths(deaths) {
    this.emit('game:night_result', {
      deaths:  deaths.map(d => ({ id: d.id, name: d.name, role: d.role, cause: d.cause })),
      players: this.getPublicPlayers(),
    });

    const win = this._checkWin();
    if (win) { this._setTimeout(() => this._endGame(win), DURATION.SHOW_RESULT); return; }

    this._setTimeout(() => this._startDay(), DURATION.SHOW_RESULT);
  }

  // ════════════════════════════════════════
  // NGÀY
  // ════════════════════════════════════════
  _startDay() {
    this.state.phase = 'day_chat';
    this.emit('game:day_start', {
      round:       this.state.round,
      players:     this.getPublicPlayers(),
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
      duration: DURATION.DAY_
