import { jsonResponse, errorResponse, corsHeaders } from './utils/response.js';
import { loadAllPlayerPicks } from './utils/pickLoader.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

// Load scoring config
let scoringConfig;
try {
  const configPath = join(process.cwd(), 'config', 'scoring.json');
  scoringConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.warn('Could not load scoring config, using defaults');
  scoringConfig = {
    points: { groupStage: 1, knockoutRound: 2, medalRound: 3 },
    exactScoreBonus: { enabled: false, points: 1 }
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Fetch games from ESPN API
    const games = await fetchGamesFromESPN();

    // Load all player picks from static CSVs
    const playersWithPicks = loadAllPlayerPicks();

    // Build game lookup by ESPN event ID
    const gameMap = new Map(games.map(g => [g.espnEventId, g]));

    // Calculate scores for each player
    const leaderboard = playersWithPicks.map(player => {
      let totalPoints = 0;
      let correctPicks = 0;
      let scoredGames = 0;

      const roundBreakdown = {
        groupStage: { correct: 0, total: 0, points: 0 },
        knockoutRound: { correct: 0, total: 0, points: 0 },
        medalRound: { correct: 0, total: 0, points: 0 },
      };

      for (const pick of player.picks || []) {
        const game = gameMap.get(pick.gameId);
        if (!game || game.status?.state !== 'final') continue;

        scoredGames++;
        const roundType = game.roundType || 'groupStage';
        const basePoints = scoringConfig.points[roundType] || 1;

        // Determine actual result
        const actualResult = getResult(game.scores?.teamA, game.scores?.teamB);
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
            if (pick.teamAScore === game.scores?.teamA &&
                pick.teamBScore === game.scores?.teamB) {
              totalPoints += scoringConfig.exactScoreBonus.points;
              if (roundBreakdown[roundType]) {
                roundBreakdown[roundType].points += scoringConfig.exactScoreBonus.points;
              }
            }
          }
        }
      }

      return {
        playerId: player.id,
        playerName: player.name,
        displayOrder: player.displayOrder,
        totalPoints,
        correctPicks,
        totalPicks: player.picks?.length || 0,
        scoredGames,
        accuracy: scoredGames > 0 ? ((correctPicks / scoredGames) * 100).toFixed(1) : '0.0',
        roundBreakdown,
      };
    });

    // Sort by points, then correct picks, then name
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

    // Calculate tournament progress
    const totalGames = games.length;
    const completedGames = games.filter(g => g.status?.state === 'final').length;
    const inProgressGames = games.filter(g => g.status?.state === 'in_progress').length;

    return jsonResponse({
      leaderboard,
      tournamentProgress: {
        totalGames,
        completedGames,
        inProgressGames,
        percentComplete: totalGames > 0 ? ((completedGames / totalGames) * 100).toFixed(1) : '0.0',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calculating leaderboard:', error);
    return errorResponse(error.message);
  }
}

function getResult(scoreA, scoreB) {
  if (scoreA === null || scoreB === null) return null;
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

async function fetchGamesFromESPN() {
  const dateRange = '20260211-20260222';
  const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN API error: ${response.status}`);
  }

  const data = await response.json();
  return parseScheduleResponse(data);
}

function parseScheduleResponse(data) {
  const games = [];

  if (!data.events) return games;

  for (const event of data.events) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const competitors = competition.competitors || [];
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');

    games.push({
      espnEventId: event.id,
      name: event.name,
      scheduledAt: event.date,
      status: parseGameStatus(competition.status),
      roundType: parseRoundType(event.season?.type?.name, event.name),
      scores: {
        teamA: awayTeam?.score ? parseInt(awayTeam.score, 10) : null,
        teamB: homeTeam?.score ? parseInt(homeTeam.score, 10) : null,
      },
    });
  }

  return games;
}

function parseGameStatus(status) {
  if (!status) return { state: 'unknown' };

  const typeId = status.type?.id;
  const stateName = status.type?.name?.toLowerCase();

  if (typeId === '1' || stateName === 'scheduled') {
    return { state: 'scheduled' };
  }
  if (typeId === '2' || stateName === 'in progress') {
    return { state: 'in_progress' };
  }
  if (typeId === '3' || stateName === 'final') {
    return { state: 'final' };
  }

  return { state: stateName || 'unknown' };
}

function parseRoundType(seasonTypeName, eventName) {
  const name = (seasonTypeName || eventName || '').toLowerCase();

  if (name.includes('gold') || name.includes('bronze')) {
    return 'medalRound';
  }
  if (name.includes('semifinal') || name.includes('quarterfinal') || name.includes('knockout')) {
    return 'knockoutRound';
  }

  return 'groupStage';
}
