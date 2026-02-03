/**
 * Client-side leaderboard calculation
 * Calculates player scores from games and picks data
 */

// Default scoring config
const DEFAULT_SCORING_CONFIG = {
  points: { groupStage: 1, knockoutRound: 2, medalRound: 3 },
  exactScoreBonus: { enabled: false, points: 1 }
};

/**
 * Calculate game result from scores
 */
function getResult(scoreA, scoreB) {
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return null;
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

/**
 * Calculate leaderboard from games and picks data
 * @param {Array} games - Array of game objects from ESPN
 * @param {Array} picks - Array of pick objects from Supabase (getAllVisible)
 * @param {Array} profiles - Array of profile objects from Supabase
 * @param {Object} scoringConfig - Optional scoring configuration
 * @returns {Array} Sorted leaderboard with player rankings
 */
export function calculateLeaderboard(games, picks, profiles, scoringConfig = DEFAULT_SCORING_CONFIG) {
  // Build game lookup by ESPN event ID
  const gameMap = new Map(games.map(g => [g.espnEventId || g.id, g]));

  // Group picks by user_id
  const picksByUser = {};
  for (const pick of picks) {
    const userId = pick.user_id;
    if (!picksByUser[userId]) {
      picksByUser[userId] = [];
    }

    const teamAScore = pick.team_a_score ?? 0;
    const teamBScore = pick.team_b_score ?? 0;

    picksByUser[userId].push({
      gameId: pick.game_id,
      teamAScore,
      teamBScore,
      predictedResult: getResult(teamAScore, teamBScore),
    });
  }

  // Calculate scores for each player
  const leaderboard = profiles.map((profile, index) => {
    const userPicks = picksByUser[profile.id] || [];
    let totalPoints = 0;
    let correctPicks = 0;
    let scoredGames = 0;

    const roundBreakdown = {
      groupStage: { correct: 0, total: 0, points: 0 },
      knockoutRound: { correct: 0, total: 0, points: 0 },
      medalRound: { correct: 0, total: 0, points: 0 },
    };

    for (const pick of userPicks) {
      const game = gameMap.get(pick.gameId);
      if (!game || game.status?.state !== 'final') continue;

      scoredGames++;
      const roundType = game.roundType || game.round_type || 'groupStage';
      const basePoints = scoringConfig.points[roundType] || 1;

      // Determine actual result
      const actualResult = getResult(game.scores?.teamA || game.score_a, game.scores?.teamB || game.score_b);
      const isCorrect = pick.predictedResult === actualResult;

      if (roundBreakdown[roundType]) {
        roundBreakdown[roundType].total++;
      }

      if (isCorrect) {
        correctPicks++;
        totalPoints += basePoints;

        if (roundBreakdown[roundType]) {
          roundBreakdown[roundType].correct++;
          roundBreakdown[roundType].points += basePoints;
        }

        // Check exact score bonus
        if (scoringConfig.exactScoreBonus?.enabled) {
          const gameScoreA = game.scores?.teamA || game.score_a;
          const gameScoreB = game.scores?.teamB || game.score_b;
          if (pick.teamAScore === gameScoreA && pick.teamBScore === gameScoreB) {
            totalPoints += scoringConfig.exactScoreBonus.points;
            if (roundBreakdown[roundType]) {
              roundBreakdown[roundType].points += scoringConfig.exactScoreBonus.points;
            }
          }
        }
      }
    }

    return {
      playerId: profile.id,
      playerName: profile.name || profile.email || 'Unknown Player',
      displayOrder: index + 1,
      totalPoints,
      correctPicks,
      totalPicks: userPicks.length,
      scoredGames,
      accuracy: scoredGames > 0 ? ((correctPicks / scoredGames) * 100).toFixed(1) : '0.0',
      roundBreakdown,
    };
  });

  // Sort leaderboard by points, then correct picks, then name
  leaderboard.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.correctPicks !== a.correctPicks) return b.correctPicks - a.correctPicks;
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

/**
 * Enrich games with pick information for display
 * @param {Array} games - Array of game objects from ESPN
 * @param {Array} picks - Array of pick objects from Supabase (getAllVisible)
 * @param {Object} scoringConfig - Optional scoring configuration
 * @returns {Array} Games enriched with pick information
 */
export function enrichGamesWithPicks(games, picks, scoringConfig = DEFAULT_SCORING_CONFIG) {
  // Create a lookup of picks by game ID
  const picksByGame = {};
  for (const pick of picks) {
    const gameId = pick.game_id;
    if (!picksByGame[gameId]) {
      picksByGame[gameId] = [];
    }

    const teamAScore = pick.team_a_score ?? 0;
    const teamBScore = pick.team_b_score ?? 0;

    picksByGame[gameId].push({
      playerId: pick.user_id,
      playerName: pick.profiles?.name || 'Unknown',
      teamAScore,
      teamBScore,
      predictedResult: getResult(teamAScore, teamBScore),
    });
  }

  const now = new Date();

  return games.map(game => {
    const gameId = game.espnEventId || game.id;
    const isFinal = game.status?.state === 'final';
    const isInProgress = game.status?.state === 'in_progress';
    const gameStarted = new Date(game.scheduledAt) <= now || isFinal || isInProgress;
    const gamePicks = picksByGame[gameId] || [];
    const actualResult = getResult(game.scores?.teamA, game.scores?.teamB);
    const roundType = game.roundType || 'groupStage';
    const basePoints = scoringConfig.points[roundType] || 1;

    return {
      id: gameId,
      game_id: gameId,
      espn_event_id: gameId,
      name: game.name,
      short_name: game.shortName,
      scheduled_at: game.scheduledAt,
      status: game.status?.state || 'scheduled',
      round_type: game.roundType,
      venue: game.venue,
      score_a: game.scores?.teamA,
      score_b: game.scores?.teamB,
      result: actualResult,
      team_a: game.teamA,
      team_b: game.teamB,
      picks: gameStarted
        ? gamePicks.map(p => {
            const isCorrect = isFinal && actualResult && p.predictedResult === actualResult;
            const pointsEarned = isCorrect ? basePoints : 0;
            return {
              playerId: p.playerId,
              playerName: p.playerName,
              predictedScoreA: p.teamAScore,
              predictedScoreB: p.teamBScore,
              predictedResult: p.predictedResult,
              isCorrect,
              pointsEarned,
            };
          })
        : gamePicks.map(p => ({
            playerId: p.playerId,
            playerName: p.playerName,
            submitted: true,
          })),
      picksVisible: gameStarted,
      hasAllPicks: gamePicks.length > 0,
    };
  });
}

export default {
  calculateLeaderboard,
  enrichGamesWithPicks,
};
