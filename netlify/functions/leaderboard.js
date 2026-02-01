import { jsonResponse, errorResponse, corsHeaders } from './utils/response.js';
import { loadAllPlayerPicks, loadMockGamesData, loadScoringConfig, loadGameOverrides } from './utils/pickLoader.js';
import { createSupabaseClient, getAllProfiles, getAllPicks, isSupabaseConfigured } from './utils/supabase.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

// Use mock data if ESPN returns empty or USE_MOCK_DATA env var is set
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

// Use CSV picks instead of Supabase (for backward compatibility)
const USE_CSV_PICKS = process.env.USE_CSV_PICKS === 'true';

// Load scoring config
const scoringConfig = loadScoringConfig();

// Apply game overrides if enabled (for testing)
function applyGameOverrides(games) {
  const overrides = loadGameOverrides();
  if (!overrides.enabled || !overrides.overrides) {
    return games;
  }

  console.log('Applying game overrides for leaderboard');

  return games.map(game => {
    const override = overrides.overrides[game.espnEventId];
    if (!override) return game;

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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Fetch games from ESPN API
    let games = await fetchGamesFromESPN();

    // Apply any game overrides for testing
    games = applyGameOverrides(games);

    // Load picks - prefer Supabase, fall back to CSV
    const playersWithPicks = await loadPlayersWithPicks();

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

/**
 * Load players with their picks from Supabase or CSV fallback
 */
async function loadPlayersWithPicks() {
  // Use CSV if explicitly requested or Supabase not configured
  if (USE_CSV_PICKS || !isSupabaseConfigured()) {
    console.log('Loading picks from CSV files');
    return loadAllPlayerPicks();
  }

  try {
    console.log('Loading picks from Supabase');
    const supabase = createSupabaseClient();
    if (!supabase) {
      console.warn('Supabase client not available, falling back to CSV');
      return loadAllPlayerPicks();
    }

    // Get all profiles (users)
    const profiles = await getAllProfiles(supabase);
    if (!profiles || profiles.length === 0) {
      console.log('No profiles in Supabase, falling back to CSV');
      return loadAllPlayerPicks();
    }

    // Get all picks
    const allPicks = await getAllPicks(supabase);

    // Group picks by user
    const picksByUser = {};
    for (const pick of allPicks) {
      const userId = pick.user_id;
      if (!picksByUser[userId]) {
        picksByUser[userId] = [];
      }
      picksByUser[userId].push({
        gameId: pick.game_id,
        teamAScore: pick.team_a_score,
        teamBScore: pick.team_b_score,
        predictedResult: getResult(pick.team_a_score, pick.team_b_score),
      });
    }

    // Combine profiles with picks
    return profiles.map(profile => ({
      id: profile.id,
      name: profile.name || profile.email || 'Unknown',
      picks: picksByUser[profile.id] || [],
    }));
  } catch (error) {
    console.error('Error loading from Supabase, falling back to CSV:', error.message);
    return loadAllPlayerPicks();
  }
}

async function fetchGamesFromESPN() {
  // Check if we should use mock data
  if (USE_MOCK_DATA) {
    console.log('Using mock data (USE_MOCK_DATA=true)');
    return loadMockGames();
  }

  try {
    const dateRange = '20260211-20260222';
    const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;

    const response = await fetch(url);
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
