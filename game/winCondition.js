// game/winCondition.js

const { ROLES, TEAMS } = require('../shared/constants');
const { isWerewolf }   = require('../roles/index');

function checkWin(state) {
  const alive      = Object.values(state.players).filter(p => p.alive);
  const wolves     = alive.filter(p => isWerewolf(p.role));
  const arsonists  = alive.filter(p => p.role === ROLES.ARSONIST);
  const fools      = alive.filter(p => p.role === ROLES.FOOL);

  // Những người thuộc phe "đe dọa" (cần tiêu diệt để Dân thắng)
  const threats    = alive.filter(p => isWerewolf(p.role) || p.role === ROLES.ARSONIST);
  // Dân thuần (không phải Sói, không phải Kẻ Phóng Hỏa, không phải phe thứ ba)
  const villagers  = alive.filter(p =>
    !isWerewolf(p.role) &&
    p.role !== ROLES.ARSONIST &&
    p.role !== ROLES.FOOL
  );

  // ── 1. Sói Trắng solo ────────────────────
  if (alive.length === 1 && alive[0].role === ROLES.WHITE_WOLF) {
    return {
      winner:     TEAMS.SOLO,
      winnerRole: ROLES.WHITE_WOLF,
      message:    '🤍 Sói Trắng thắng! Kẻ bí ẩn là người duy nhất còn sống!',
    };
  }

  // ── 2. Thằng Ngốc thắng khi sống tới cuối ─
  // (chỉ còn mình Thằng Ngốc + không có ai khác đáng kể)
  if (alive.length === 1 && alive[0].role === ROLES.FOOL) {
    return {
      winner:     TEAMS.SOLO,
      winnerRole: ROLES.FOOL,
      message:    `🤡 ${alive[0].name} (Thằng Ngốc) thắng! Kẻ điên cuồng sống sót!`,
    };
  }

  // ── 3. Kẻ Phóng Hỏa thắng khi sống tới cuối ─
  if (alive.length === 1 && alive[0].role === ROLES.ARSONIST) {
    return {
      winner:     TEAMS.SOLO,
      winnerRole: ROLES.ARSONIST,
      message:    `🔥 ${alive[0].name} (Kẻ Phóng Hỏa) thắng! Ngọn lửa thiêu rụi tất cả!`,
    };
  }

  // ── 4. Cặp đôi phe thứ ba ────────────────
  if (state.lovers && state.loverTeam === TEAMS.LOVERS) {
    const [id1, id2] = state.lovers;
    const l1 = state.players[id1];
    const l2 = state.players[id2];
    if (l1?.alive && l2?.alive && alive.length === 2) {
      return {
        winner:  TEAMS.LOVERS,
        message: `💘 ${l1.name} & ${l2.name} thắng! Tình yêu chiến thắng tất cả!`,
      };
    }
  }

  // ── 5. Dân thắng: không còn Sói VÀ không còn Kẻ Phóng Hỏa ──
  if (wolves.length === 0 && arsonists.length === 0) {
    return {
      winner:  TEAMS.VILLAGE,
      message: '🌻 Dân Làng thắng! Tất cả kẻ thù đã bị tiêu diệt!',
    };
  }

  // ── 6. Sói thắng: Sói >= tổng người không phải Sói ──
  // (kể cả Kẻ Phóng Hỏa, Thằng Ngốc cũng tính vào nonWolves)
  const nonWolves = alive.filter(p => !isWerewolf(p.role));
  if (wolves.length >= nonWolves.length) {
    return {
      winner:  TEAMS.WEREWOLF,
      message: '🐺 Ma Sói thắng! Bóng tối đã nuốt chửng ngôi làng!',
    };
  }

  // ── 7. Kẻ Phóng Hỏa thắng: threats >= villagers ──
  // Nếu chỉ còn Kẻ Phóng Hỏa + ít dân hơn hoặc bằng
  if (arsonists.length > 0 && wolves.length === 0 && arsonists.length >= villagers.length) {
    return {
      winner:     TEAMS.SOLO,
      winnerRole: ROLES.ARSONIST,
      message:    '🔥 Kẻ Phóng Hỏa thắng! Ngọn lửa thiêu rụi tất cả!',
    };
  }

  return null;
}

module.exports = { checkWin };
