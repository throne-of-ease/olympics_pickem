import scoringConfig from '../../config/scoring.json';

/**
 * Determine the result of a game based on scores
 * @param {number} scoreA - Team A (away) score
 * @param {number} scoreB - Team B (home) score
 * @returns {'win_a' | 'win_b' | 'tie'}
 */
export function getResult(scoreA, scoreB) {
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

/**
 * Compare predicted result to actual result
 * @param {string} predictedResult - Predicted result
 * @param {string} actualResult - Actual result
 * @returns {boolean}
 */
export function compareResults(predictedResult, actualResult) {
  return predictedResult === actualResult;
}

/**
 * Check if predicted scores match actual scores exactly
 * @param {Object} predicted - { teamA: number, teamB: number }
 * @param {Object} actual - { teamA: number, teamB: number }
 * @returns {boolean}
 */
export function compareExactScores(predicted, actual) {
  return predicted.teamA === actual.teamA && predicted.teamB === actual.teamB;
}

/**
 * Determine round type from game data
 * @param {Object} game - Game object with roundType or name
 * @returns {'groupStage' | 'knockoutRound' | 'medalRound'}
 */
export function getRoundType(game) {
  // If already has roundType, use it
  if (game.roundType && ['groupStage', 'knockoutRound', 'medalRound'].includes(game.roundType)) {
    return game.roundType;
  }

  // Try to determine from name or other fields
  const name = (game.name || game.roundName || '').toLowerCase();

  // Check config mappings first
  for (const [key, value] of Object.entries(scoringConfig.roundTypes || {})) {
    if (name.includes(key.toLowerCase())) {
      return value;
    }
  }

  // Default fallbacks
  if (name.includes('gold') || name.includes('bronze')) {
    return 'medalRound';
  }
  if (name.includes('semifinal') || name.includes('quarterfinal')) {
    return 'knockoutRound';
  }

  return 'groupStage';
}

/**
 * Get points for a round type
 * @param {string} roundType - Round type
 * @returns {number}
 */
export function getPointsForRound(roundType) {
  return scoringConfig.points[roundType] || scoringConfig.points.groupStage;
}

/**
 * Calculate points for a single pick
 * @param {Object} pick - Player pick with predicted scores/result
 * @param {Object} game - Game with actual scores/result
 * @param {Object} config - Optional scoring config override
 * @returns {Object} Score result
 */
export function calculatePickScore(pick, game, config = scoringConfig) {
  const result = {
    gameId: game.espnEventId || game.id,
    isCorrect: false,
    basePoints: 0,
    bonusPoints: 0,
    totalPoints: 0,
    details: {},
  };

  // Game must be final to score
  if (game.status?.state !== 'final' && game.status !== 'final') {
    result.details.reason = 'Game not completed';
    return result;
  }

  // Get actual result
  const actualScores = game.scores || { teamA: game.scoreA, teamB: game.scoreB };
  if (actualScores.teamA === null || actualScores.teamB === null) {
    result.details.reason = 'Missing actual scores';
    return result;
  }

  const actualResult = getResult(actualScores.teamA, actualScores.teamB);
  const roundType = getRoundType(game);
  const basePoints = config.points[roundType] || 1;

  // Compare results
  const predictedResult = pick.predictedResult || getResult(pick.teamAScore, pick.teamBScore);
  result.isCorrect = compareResults(predictedResult, actualResult);

  if (result.isCorrect) {
    result.basePoints = basePoints;
    result.totalPoints = basePoints;

    // Check for exact score bonus
    if (config.exactScoreBonus?.enabled) {
      const predictedScores = {
        teamA: pick.teamAScore ?? pick.predicted_team_a_score,
        teamB: pick.teamBScore ?? pick.predicted_team_b_score,
      };

      if (compareExactScores(predictedScores, actualScores)) {
        result.bonusPoints = config.exactScoreBonus.points;
        result.totalPoints += result.bonusPoints;
        result.details.exactScore = true;
      }
    }
  }

  result.details = {
    ...result.details,
    roundType,
    predictedResult,
    actualResult,
    predictedScores: {
      teamA: pick.teamAScore ?? pick.predicted_team_a_score,
      teamB: pick.teamBScore ?? pick.predicted_team_b_score
    },
    actualScores,
  };

  return result;
}

/**
 * Calculate total score for a player across all their picks
 * @param {Array} playerPicks - Array of player picks
 * @param {Array} games - Array of games with results
 * @param {Object} config - Optional scoring config override
 * @returns {Object} Player score summary
 */
export function calculatePlayerScore(playerPicks, games, config = scoringConfig) {
  const gameMap = new Map(
    games.map(g => [g.espnEventId || g.id || g.game_espn_id, g])
  );

  const pickResults = [];
  let totalPoints = 0;
  let correctPicks = 0;
  let scoredGames = 0;

  const roundBreakdown = {
    groupStage: { correct: 0, total: 0, points: 0 },
    knockoutRound: { correct: 0, total: 0, points: 0 },
    medalRound: { correct: 0, total: 0, points: 0 },
  };

  for (const pick of playerPicks) {
    const gameId = pick.gameId || pick.game_espn_id;
    const game = gameMap.get(gameId);

    if (!game) {
      pickResults.push({
        gameId,
        error: 'Game not found',
        totalPoints: 0,
      });
      continue;
    }

    const result = calculatePickScore(pick, game, config);
    pickResults.push(result);

    // Only count completed games
    if (game.status?.state === 'final' || game.status === 'final') {
      scoredGames++;
      totalPoints += result.totalPoints;

      if (result.isCorrect) {
        correctPicks++;
      }

      // Update round breakdown
      const roundType = result.details?.roundType || getRoundType(game);
      if (roundBreakdown[roundType]) {
        roundBreakdown[roundType].total++;
        if (result.isCorrect) {
          roundBreakdown[roundType].correct++;
          roundBreakdown[roundType].points += result.totalPoints;
        }
      }
    }
  }

  return {
    totalPoints,
    correctPicks,
    totalPicks: playerPicks.length,
    scoredGames,
    accuracy: scoredGames > 0 ? ((correctPicks / scoredGames) * 100).toFixed(1) : 0,
    pickResults,
    roundBreakdown,
  };
}

/**
 * Calculate leaderboard for all players
 * @param {Array} players - Array of player objects with picks
 * @param {Array} games - Array of games with results
 * @param {Object} config - Optional scoring config override
 * @returns {Array} Sorted leaderboard
 */
export function calculateLeaderboard(players, games, config = scoringConfig) {
  const leaderboard = [];

  for (const player of players) {
    const picks = player.picks || [];
    const score = calculatePlayerScore(picks, games, config);

    leaderboard.push({
      playerId: player.id,
      playerName: player.name,
      displayOrder: player.display_order,
      ...score,
    });
  }

  // Sort by total points descending, then by correct picks, then by name
  leaderboard.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    if (b.correctPicks !== a.correctPicks) {
      return b.correctPicks - a.correctPicks;
    }
    return a.playerName.localeCompare(b.playerName);
  });

  // Add ranks
  let currentRank = 1;
  for (let i = 0; i < leaderboard.length; i++) {
    if (i > 0 && leaderboard[i].totalPoints < leaderboard[i - 1].totalPoints) {
      currentRank = i + 1;
    }
    leaderboard[i].rank = currentRank;
  }

  return leaderboard;
}

export default {
  getResult,
  compareResults,
  compareExactScores,
  getRoundType,
  getPointsForRound,
  calculatePickScore,
  calculatePlayerScore,
  calculateLeaderboard,
};
