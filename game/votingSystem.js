// game/votingSystem.js
// Hệ thống bỏ phiếu: tính phiếu, hoà phiếu, skip, sheriff 2 phiếu

function initVoting() {
  return {
    votes:     {}, // socketId -> targetId | 'skip'
    startTime: Date.now(),
  };
}

function castVote(voting, voterId, targetId) {
  voting.votes[voterId] = targetId;
}

// ─────────────────────────────────────────────
// tallyVotes — tính phiếu từ state.voting
// Trả về { executed, tally, tied, skipWon }
//   executed: null | string | string[]
//   tally:    { targetId: count }
//   tied:     boolean
//   skipWon:  boolean
// ─────────────────────────────────────────────
function tallyVotes(voting, players, settings = {}) {
  const tally     = {};
  let   skipCount = 0;

  for (const [voterId, targetId] of Object.entries(voting.votes)) {
    const voter = players[voterId];
    if (!voter || !voter.alive) continue;

    if (targetId === 'skip') {
      skipCount++;
      continue;
    }

    const weight = voter.isSheriff ? 2 : 1;
    tally[targetId] = (tally[targetId] || 0) + weight;
  }

  if (skipCount > 0) tally['skip'] = skipCount;

  // Không ai vote
  if (Object.keys(tally).length === 0) {
    return { executed: null, tally, tied: false, skipWon: true };
  }

  const maxVal  = Math.max(...Object.values(tally));
  const topKeys = Object.keys(tally).filter(k => tally[k] === maxVal);

  // Skip thắng
  if (topKeys.includes('skip')) {
    return { executed: null, tally, tied: false, skipWon: true };
  }

  // Hoà phiếu
  if (topKeys.length > 1) {
    if (settings.tieKillAll) {
      // Treo tất cả người hoà
      return { executed: topKeys, tally, tied: true, skipWon: false };
    }
    // Không ai chết
    return { executed: null, tally, tied: true, skipWon: false };
  }

  // 1 người nhiều phiếu nhất
  return { executed: topKeys[0], tally, tied: false, skipWon: false };
}

// ─────────────────────────────────────────────
// voteSummary — ai vote cho ai (để hiển thị)
// Trả về { targetId: [{ id, name, weight }] }
// ─────────────────────────────────────────────
function voteSummary(voting, players) {
  const summary = {};
  for (const [voterId, targetId] of Object.entries(voting.votes)) {
    const voter = players[voterId];
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

// ─────────────────────────────────────────────
// allVoted — kiểm tra tất cả người sống đã vote chưa
// ─────────────────────────────────────────────
function allVoted(voting, players) {
  const alive = Object.values(players).filter(p => p.alive);
  return alive.every(p => voting.votes[p.id] !== undefined);
}

module.exports = { initVoting, castVote, tallyVotes, voteSummary, allVoted };
                                              
