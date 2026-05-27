// shared/constants.js

const PHASES = {
  LOBBY:            'lobby',
  NIGHT:            'night',
  NIGHT_THIEF:      'night_thief',
  NIGHT_WEREWOLF:   'night_werewolf',
  NIGHT_GUARD:      'night_guard',
  NIGHT_WITCH:      'night_witch',
  NIGHT_SEER:       'night_seer',
  NIGHT_CUPID:      'night_cupid',
  NIGHT_WHITE_WOLF: 'night_white_wolf',
  DAY_CHAT:         'day_chat',
  DAY_VOTE:         'day_vote',
  VOTE_RESULT:      'vote_result',
  SHERIFF_ELECTION: 'sheriff_election',
  GAME_OVER:        'game_over',
};

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

// Thời lượng (ms)
const DURATION = {
  DAY_CHAT:         30_000,
  DAY_VOTE:         90_000,
  VOTE_RESULT:       5_000,
  NIGHT_ACTION:     30_000,
  NIGHT_FAKE_MIN:    5_000,
  NIGHT_FAKE_MAX:   10_000,
  SHERIFF_VOTE:     30_000,
  HUNTER_SHOOT:     15_000,
  SHOW_RESULT:       4_000,
};

// Thứ tự đêm đúng spec
// Round 1: Thief → Wolf → Guard → Witch → Seer → Cupid → WhiteWolf
// Round 2+:         Wolf → Guard → Witch → Seer → WhiteWolf
const NIGHT_ORDER_R1 = [
  PHASES.NIGHT_THIEF,
  PHASES.NIGHT_WEREWOLF,
  PHASES.NIGHT_GUARD,
  PHASES.NIGHT_WITCH,
  PHASES.NIGHT_SEER,
  PHASES.NIGHT_CUPID,
  PHASES.NIGHT_WHITE_WOLF,
];

const NIGHT_ORDER = [
  PHASES.NIGHT_WEREWOLF,
  PHASES.NIGHT_GUARD,
  PHASES.NIGHT_WITCH,
  PHASES.NIGHT_SEER,
  PHASES.NIGHT_WHITE_WOLF,
];

// Role thuộc phe Sói
const WOLF_ROLES = [ROLES.WEREWOLF, ROLES.WOLF_CUB, ROLES.WHITE_WOLF];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PHASES, ROLES, TEAMS, DURATION, NIGHT_ORDER_R1, NIGHT_ORDER, WOLF_ROLES };
}
