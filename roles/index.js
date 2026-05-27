// roles/index.js

const ROLES = {
  VILLAGER:   'villager',
  WEREWOLF:   'werewolf',
  SEER:       'seer',
  GUARD:      'guard',
  WITCH:      'witch',
  HUNTER:     'hunter',
  SHERIFF:    'sheriff',
  CUPID:      'cupid',
  WOLF_CUB:   'wolf_cub',
  HALF_WOLF:  'half_wolf',
  WHITE_WOLF: 'white_wolf',
  THIEF:      'thief',
};

const TEAMS = {
  VILLAGE:  'village',
  WEREWOLF: 'werewolf',
  LOVERS:   'lovers',
  SOLO:     'solo',
};

// Thứ tự đúng theo spec mới:
// Round 1: Ăn Trộm → Sói → Bảo Vệ → Phù Thủy → Tiên Tri → Cupid → Sói Trắng
// Round 2+:          Sói → Bảo Vệ → Phù Thủy → Tiên Tri → Sói Trắng
const NIGHT_PHASES = {
  THIEF:      'night_thief',
  WEREWOLF:   'night_werewolf',
  GUARD:      'night_guard',
  WITCH:      'night_witch',
  SEER:       'night_seer',
  CUPID:      'night_cupid',
  WHITE_WOLF: 'night_white_wolf',
};

// Role thuộc phe Sói (bầy cắn người)
const WOLF_ROLES = [ROLES.WEREWOLF, ROLES.WOLF_CUB, ROLES.WHITE_WOLF];

// ─────────────────────────────────────────────
function isWerewolf(roleId) {
  return WOLF_ROLES.includes(roleId);
}

function getRoleTeam(roleId) {
  return WOLF_ROLES.includes(roleId) ? TEAMS.WEREWOLF : TEAMS.VILLAGE;
}

// ─────────────────────────────────────────────
// buildRoleList — tạo danh sách role cho N người
// ─────────────────────────────────────────────
function buildRoleList(playerCount, settings) {
  const s     = settings.roles || {};
  const roles = [];

  // Sói — tối đa floor(N/3)
  const wolfCount = Math.min(
    Math.max(1, parseInt(s.werewolf) || 2),
    Math.floor(playerCount / 3)
  );
  for (let i = 0; i < wolfCount; i++) roles.push(ROLES.WEREWOLF);

  if (s.wolf_cub)   roles.push(ROLES.WOLF_CUB);
  if (s.white_wolf) roles.push(ROLES.WHITE_WOLF);
  if (s.seer)       roles.push(ROLES.SEER);
  if (s.guard)      roles.push(ROLES.GUARD);
  if (s.witch)      roles.push(ROLES.WITCH);
  if (s.hunter)     roles.push(ROLES.HUNTER);
  if (s.cupid)      roles.push(ROLES.CUPID);
  if (s.half_wolf)  roles.push(ROLES.HALF_WOLF);
  if (s.thief)      roles.push(ROLES.THIEF);

  while (roles.length < playerCount) roles.push(ROLES.VILLAGER);

  const finalRoles = roles.slice(0, playerCount);

  // 2 role dư cho Ăn Trộm — lấy ngẫu nhiên từ pool KHÔNG bao gồm role đã assign
  // Luôn có ít nhất 1 Sói trong pool để cơ chế "bắt buộc chọn Sói" hoạt động
  let thiefExtraRoles = [];
  if (s.thief) {
    thiefExtraRoles = [ROLES.WEREWOLF, ROLES.VILLAGER];
  }

  return { roles: finalRoles, thiefExtraRoles };
}

// ─────────────────────────────────────────────
// buildNightQueue — thứ tự phase đúng spec
// ─────────────────────────────────────────────
function buildNightQueue(round, roomSettings, gamePlayers) {
  const s     = roomSettings.roles || {};
  const queue = [];

  // Round 1: Ăn Trộm đi đầu tiên
  if (round === 1 && s.thief)  queue.push(NIGHT_PHASES.THIEF);

  // Mỗi đêm: Sói luôn có mặt (fake nếu đã chết hết)
  queue.push(NIGHT_PHASES.WEREWOLF);

  if (s.guard)      queue.push(NIGHT_PHASES.GUARD);
  if (s.witch)      queue.push(NIGHT_PHASES.WITCH);
  if (s.seer)       queue.push(NIGHT_PHASES.SEER);

  // Round 1: Cupid sau Tiên Tri
  if (round === 1 && s.cupid)  queue.push(NIGHT_PHASES.CUPID);

  // Sói Trắng cuối mỗi đêm (mỗi 2 đêm mới có lượt thật)
  if (s.white_wolf) queue.push(NIGHT_PHASES.WHITE_WOLF);

  return queue;
}

// ─────────────────────────────────────────────
function isRoleAlive(roleId, gamePlayers) {
  return Object.values(gamePlayers).some(p => p.alive && p.role === roleId);
}

function getAliveWolves(gamePlayers) {
  return Object.values(gamePlayers).filter(p => p.alive && isWerewolf(p.role));
}

function getAliveVillagers(gamePlayers) {
  return Object.values(gamePlayers).filter(p => p.alive && !isWerewolf(p.role));
}

function getAlivePlayers(gamePlayers) {
  return Object.values(gamePlayers).filter(p => p.alive);
}

// ─────────────────────────────────────────────
const ROLE_META = {
  [ROLES.VILLAGER]:   { name: 'Dân Thường',       icon: '👨‍🌾', team: TEAMS.VILLAGE,  nightAction: false },
  [ROLES.WEREWOLF]:   { name: 'Ma Sói',            icon: '🐺',  team: TEAMS.WEREWOLF, nightAction: true  },
  [ROLES.SEER]:       { name: 'Tiên Tri',          icon: '🔮',  team: TEAMS.VILLAGE,  nightAction: true  },
  [ROLES.GUARD]:      { name: 'Bảo Vệ',            icon: '🛡️', team: TEAMS.VILLAGE,  nightAction: true  },
  [ROLES.WITCH]:      { name: 'Phù Thủy',          icon: '🧙‍♀️',team: TEAMS.VILLAGE,  nightAction: true  },
  [ROLES.HUNTER]:     { name: 'Thợ Săn',           icon: '🏹',  team: TEAMS.VILLAGE,  nightAction: false },
  [ROLES.SHERIFF]:    { name: 'Cảnh Sát Trưởng',   icon: '⭐',  team: TEAMS.VILLAGE,  nightAction: false },
  [ROLES.CUPID]:      { name: 'Thần Tình Yêu',     icon: '💘',  team: TEAMS.VILLAGE,  nightAction: true  },
  [ROLES.WOLF_CUB]:   { name: 'Sói Con',           icon: '🐾',  team: TEAMS.WEREWOLF, nightAction: false },
  [ROLES.HALF_WOLF]:  { name: 'Nửa Người Nửa Sói', icon: '🌙',  team: TEAMS.VILLAGE,  nightAction: false },
  [ROLES.WHITE_WOLF]: { name: 'Sói Trắng',         icon: '🤍',  team: TEAMS.WEREWOLF, nightAction: true  },
  [ROLES.THIEF]:      { name: 'Ăn Trộm',           icon: '🃏',  team: TEAMS.VILLAGE,  nightAction: true  },
};

module.exports = {
  ROLES,
  TEAMS,
  NIGHT_PHASES,
  WOLF_ROLES,
  ROLE_META,
  isWerewolf,
  getRoleTeam,
  buildRoleList,
  buildNightQueue,
  isRoleAlive,
  getAliveWolves,
  getAliveVillagers,
  getAlivePlayers,
};
                                         
