/**
 * Combined endpoint for games + leaderboard data
 * Reduces function invocations by 50% (1 call instead of 2)
 *
 * GET /api/tournament-data
 * Returns: { games, leaderboard, tournamentProgress, timestamp }
 */

import { jsonResponse, errorResponse, handleCors, corsHeaders } from './utils/response.js';
import { loadAllPlayerPicks, loadMockGamesData, loadScoringConfig, loadGameOverrides } from './utils/pickLoader.js';
import { handleETagCaching } from './utils/etag.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

// Load scoring config once at module level
const scoringConfig = loadScoringConfig();

export default async function handler(req, res) {
  // Handle CORS preflight
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  try {
    const now = new Date();

    // Fetch games from ESPN API (single call, used for both games and leaderboard)
    let games = await fetchGamesFromESPN();

    // Apply any game overrides for testing
    games = applyGameOverrides(games);

    // Load all player picks from static CSVs (single load)
    const playersWithPicks = loadAllPlayerPicks();

    // Build game lookup by ESPN event ID
    const gameMap = new Map(games.map(g => [g.espnEventId, g]));

    // Create a lookup of picks by game ID for games enrichment
    const picksByGame = {};
    for (const player of playersWithPicks) {
      for (const pick of player.picks || []) {
        if (!picksByGame[pick.gameId]) {
          picksByGame[pick.gameId] = [];
        }
        picksByGame[pick.gameId].push({
          ...pick,
          playerName: player.name,
        });
      }
    }

    // === GAMES DATA ===
    const enrichedGames = games.map(game => {
      const gameStarted = new Date(game.scheduledAt) <= now;
      const gamePicks = picksByGame[game.espnEventId] || [];
      const isFinal = game.status?.state === 'final';
      const actualResult = getResult(game.scores?.teamA, game.scores?.teamB);
      const roundType = game.roundType || 'groupStage';
      const basePoints = scoringConfig.points[roundType] || 1;

      return {
        id: game.espnEventId,
        game_id: game.espnEventId,
        espn_event_id: game.espnEventId,
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

    // === LEADERBOARD DATA ===
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

    // === TOURNAMENT PROGRESS ===
    const totalGames = games.length;
    const completedGames = games.filter(g => g.status?.state === 'final').length;
    const inProgressGames = games.filter(g => g.status?.state === 'in_progress').length;

    const tournamentProgress = {
      totalGames,
      completedGames,
      inProgressGames,
      percentComplete: totalGames > 0 ? ((completedGames / totalGames) * 100).toFixed(1) : '0.0',
    };

    const responseData = {
      games: enrichedGames,
      leaderboard,
      tournamentProgress,
      timestamp: now.toISOString(),
    };

    // Handle ETag caching - returns 304 if client cache is valid
    // Use shorter cache when games are in progress
    const maxAge = inProgressGames > 0 ? 30 : 60;
    if (handleETagCaching(req, res, responseData, { maxAge })) {
      return; // 304 Not Modified sent
    }

    return jsonResponse(res, responseData);
  } catch (error) {
    console.error('Error fetching tournament data:', error);
    return errorResponse(res, error.message);
  }
}

// Calculate game result from scores
function getResult(scoreA, scoreB) {
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return null;
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

// Apply game overrides if enabled (for testing)
function applyGameOverrides(games) {
  const overrides = loadGameOverrides();
  if (!overrides.enabled || !overrides.overrides) {
    return games;
  }

  console.log('Applying game overrides for testing');

  return games.map(game => {
    const override = overrides.overrides[game.espnEventId];
    if (!override) return game;

    console.log(`Override applied to game ${game.espnEventId}: ${override.scoreA}-${override.scoreB} (${override.status})`);

    return {
      ...game,
      scores: {
        teamA: override.scoreA,
        teamB: override.scoreB,
      },
      status: { state: override.status || 'final' },
    };
  });
}

async function fetchGamesFromESPN() {
  if (USE_MOCK_DATA) {
    console.log('Using mock data (USE_MOCK_DATA=true)');
    return loadMockGames();
  }

  try {
    const dateRange = '20260211-20260222';
    const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;

    // Add timeout to avoid long waits when ESPN has no data
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`ESPN API error: ${response.status}, falling back to mock data`);
      return loadMockGames();
    }

    const data = await response.json();
    const games = parseScheduleResponse(data);

    // Fall back to mock data if ESPN returns empty (Olympics not started yet)
    if (games.length === 0) {
      console.log('ESPN returned no games, using mock data');
      return loadMockGames();
    }

    return games;
  } catch (error) {
    console.warn('ESPN API failed, falling back to mock data:', error.message);
    return loadMockGames();
  }
}

function loadMockGames() {
  const mockData = loadMockGamesData();
  if (mockData) {
    return parseScheduleResponse(mockData);
  }
  return [];
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
      shortName: event.shortName,
      scheduledAt: event.date,
      status: parseGameStatus(competition.status),
      roundType: parseRoundType(event.season?.type?.name, event.name),
      venue: competition.venue?.fullName,
      teamA: awayTeam ? parseTeam(awayTeam) : null,
      teamB: homeTeam ? parseTeam(homeTeam) : null,
      scores: {
        teamA: awayTeam?.score ? parseInt(awayTeam.score, 10) : null,
        teamB: homeTeam?.score ? parseInt(homeTeam.score, 10) : null,
      },
    });
  }

  return games;
}

function parseTeam(competitor) {
  const team = competitor.team || {};
  return {
    espnId: team.id,
    name: team.displayName || team.name,
    abbreviation: team.abbreviation,
    logo: team.logo,
    color: team.color,
    alternateColor: team.alternateColor,
  };
}

function parseGameStatus(status) {
  if (!status) return { state: 'unknown' };

  const typeId = status.type?.id;
  const stateName = status.type?.name?.toLowerCase();

  if (typeId === '1' || stateName === 'scheduled') {
    return { state: 'scheduled', detail: status.type?.shortDetail };
  }
  if (typeId === '2' || stateName === 'in progress') {
    return {
      state: 'in_progress',
      period: status.period,
      clock: status.displayClock,
      detail: status.type?.shortDetail
    };
  }
  if (typeId === '3' || stateName === 'final') {
    return { state: 'final', detail: status.type?.shortDetail };
  }

  return { state: stateName || 'unknown', detail: status.type?.shortDetail };
}

function parseRoundType(seasonTypeName, eventName) {
  const name = (seasonTypeName || eventName || '').toLowerCase();

  if (name.includes('gold') || name.includes('bronze')) {
    return 'medalRound';
  }
  if (name.includes('semifinal') || name.includes('quarterfinal') || name.includes('knockout')) {
    return 'knockoutRound';
  }
  if (name.includes('group')) {
    return 'groupStage';
  }

  return 'groupStage';
}
