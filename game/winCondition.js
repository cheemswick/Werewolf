// game/winCondition.js
// Kiểm tra điều kiện thắng sau mỗi cái chết

const { ROLES, TEAMS } = require('../shared/constants');
const { isWerewolf }   = require('../roles/index');

// ─────────────────────────────────────────────
// checkWin — gọi sau mỗi lần có người chết
// Trả về null (chưa kết thúc) hoặc { winner, message, winnerRole? }
// ─────────────────────────────────────────────
function checkWin(state) {
  const alive     = Object.values(state.players).filter(p => p.alive);
  const wolves    = alive.filter(p => isWerewolf(p.role));
  const nonWolves = alive.filter(p => !isWerewolf(p.role));

  // ── 1. Sói Trắng solo ────────────────────
  // Thắng khi là người DUY NHẤT còn sống
  if (alive.length === 1 && alive[0].role === ROLES.WHITE_WOLF) {
    return {
      winner:     TEAMS.SOLO,
      winnerRole: ROLES.WHITE_WOLF,
      message:    '🤍 Sói Trắng thắng! Kẻ bí ẩn là người duy nhất còn sống!',
    };
  }

  // ── 2. Cặp đôi phe thứ ba ────────────────
  // Thắng khi cả 2 còn sống và chỉ còn 2 người
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

  // ── 3. Tất cả Sói chết → Dân thắng ──────
  if (wolves.length === 0) {
    return {
      winner:  TEAMS.VILLAGE,
      message: '🌻 Dân Làng thắng! Tất cả Ma Sói đã bị tiêu diệt!',
    };
  }

  // ── 4. Sói >= Dân còn sống → Sói thắng ──
  if (wolves.length >= nonWolves.length) {
    return {
      winner:  TEAMS.WEREWOLF,
      message: '🐺 Ma Sói thắng! Bóng tối đã nuốt chửng ngôi làng!',
    };
  }

  return null; // game chưa kết thúc
}

module.exports = { checkWin };
