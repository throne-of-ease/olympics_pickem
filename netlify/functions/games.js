import { jsonResponse, errorResponse, corsHeaders } from './utils/response.js';
import { loadAllPlayerPicksFromSupabase, loadScoringConfig, loadGameOverrides } from './utils/pickLoader.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

// Load scoring config for points calculation
const scoringConfig = loadScoringConfig();

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

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const now = new Date();

    // Fetch games from ESPN API
    let games = await fetchGamesFromESPN();

    // Apply any game overrides for testing
    games = applyGameOverrides(games);

    // Load all player picks from Supabase (falls back to static files if unavailable)
    const playersWithPicks = await loadAllPlayerPicksFromSupabase();

    // Create a lookup of picks by game ID
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

    // Enrich games with picks (hidden until game starts)
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

    return jsonResponse({
      games: enrichedGames,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    return errorResponse(error.message);
  }
}

async function fetchGamesFromESPN() {
  try {
    const dateRange = '20260211-20260222';
    const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;

    // Add timeout to avoid long waits when ESPN has no data
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`ESPN API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return parseScheduleResponse(data);
  } catch (error) {
    console.warn('ESPN API failed:', error.message);
    return [];
  }
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
