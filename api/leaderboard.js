/**
 * Backwards-compatible leaderboard endpoint
 * For new integrations, use /api/tournament-data instead (reduces calls by 50%)
 */

import { jsonResponse, errorResponse, handleCors } from './utils/response.js';
import { loadAllPlayerPicks, loadMockGamesData, loadScoringConfig, loadGameOverrides } from './utils/pickLoader.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
const scoringConfig = loadScoringConfig();

function applyGameOverrides(games) {
  const overrides = loadGameOverrides();
  if (!overrides.enabled || !overrides.overrides) return games;

  return games.map(game => {
    const override = overrides.overrides[game.espnEventId];
    if (!override) return game;
    return {
      ...game,
      scores: { teamA: override.scoreA, teamB: override.scoreB },
      status: { state: override.status || 'final' },
    };
  });
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  try {
    let games = await fetchGamesFromESPN();
    games = applyGameOverrides(games);

    const playersWithPicks = loadAllPlayerPicks();
    const gameMap = new Map(games.map(g => [g.espnEventId, g]));

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
        const actualResult = getResult(game.scores?.teamA, game.scores?.teamB);
        const isCorrect = pick.predictedResult === actualResult;

        if (roundBreakdown[roundType]) roundBreakdown[roundType].total++;

        if (isCorrect) {
          correctPicks++;
          totalPoints += basePoints;

          if (roundBreakdown[roundType]) {
            roundBreakdown[roundType].correct++;
            roundBreakdown[roundType].points += basePoints;
          }

          if (scoringConfig.exactScoreBonus?.enabled) {
            if (pick.teamAScore === game.scores?.teamA && pick.teamBScore === game.scores?.teamB) {
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

    leaderboard.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.correctPicks !== a.correctPicks) return b.correctPicks - a.correctPicks;
      return a.playerName.localeCompare(b.playerName);
    });

    let currentRank = 1;
    for (let i = 0; i < leaderboard.length; i++) {
      if (i > 0 && leaderboard[i].totalPoints < leaderboard[i - 1].totalPoints) {
        currentRank = i + 1;
      }
      leaderboard[i].rank = currentRank;
    }

    const totalGames = games.length;
    const completedGames = games.filter(g => g.status?.state === 'final').length;
    const inProgressGames = games.filter(g => g.status?.state === 'in_progress').length;

    return jsonResponse(res, {
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
    return errorResponse(res, error.message);
  }
}

function getResult(scoreA, scoreB) {
  if (scoreA === null || scoreB === null) return null;
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

async function fetchGamesFromESPN() {
  if (USE_MOCK_DATA) return loadMockGames();

  try {
    const dateRange = '20260211-20260222';
    const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return loadMockGames();

    const data = await response.json();
    const games = parseScheduleResponse(data);
    return games.length === 0 ? loadMockGames() : games;
  } catch (error) {
    return loadMockGames();
  }
}

function loadMockGames() {
  const mockData = loadMockGamesData();
  return mockData ? parseScheduleResponse(mockData) : [];
}

function parseScheduleResponse(data) {
  if (!data.events) return [];

  return data.events.map(event => {
    const competition = event.competitions?.[0];
    if (!competition) return null;

    const competitors = competition.competitors || [];
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');

    return {
      espnEventId: event.id,
      name: event.name,
      scheduledAt: event.date,
      status: parseGameStatus(competition.status),
      roundType: parseRoundType(event.season?.type?.name, event.name),
      scores: {
        teamA: awayTeam?.score ? parseInt(awayTeam.score, 10) : null,
        teamB: homeTeam?.score ? parseInt(homeTeam.score, 10) : null,
      },
    };
  }).filter(Boolean);
}

function parseGameStatus(status) {
  if (!status) return { state: 'unknown' };
  const typeId = status.type?.id;
  const stateName = status.type?.name?.toLowerCase();

  if (typeId === '1' || stateName === 'scheduled') return { state: 'scheduled' };
  if (typeId === '2' || stateName === 'in progress') return { state: 'in_progress' };
  if (typeId === '3' || stateName === 'final') return { state: 'final' };
  return { state: stateName || 'unknown' };
}

function parseRoundType(seasonTypeName, eventName) {
  const name = (seasonTypeName || eventName || '').toLowerCase();
  if (name.includes('gold') || name.includes('bronze')) return 'medalRound';
  if (name.includes('semifinal') || name.includes('quarterfinal') || name.includes('knockout')) return 'knockoutRound';
  return 'groupStage';
}
