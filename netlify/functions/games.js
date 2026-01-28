import { jsonResponse, errorResponse, corsHeaders } from './utils/response.js';
import { loadAllPlayerPicks, loadMockGamesData } from './utils/pickLoader.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

// Use mock data if ESPN returns empty or USE_MOCK_DATA env var is set
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

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
    const games = await fetchGamesFromESPN();

    // Load all player picks from static CSVs
    const playersWithPicks = loadAllPlayerPicks();

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

      return {
        id: game.espnEventId,
        espn_event_id: game.espnEventId,
        name: game.name,
        short_name: game.shortName,
        scheduled_at: game.scheduledAt,
        status: game.status?.state || 'scheduled',
        round_type: game.roundType,
        venue: game.venue,
        score_a: game.scores?.teamA,
        score_b: game.scores?.teamB,
        team_a: game.teamA,
        team_b: game.teamB,
        picks: gameStarted
          ? gamePicks.map(p => ({
              playerId: p.playerId,
              playerName: p.playerName,
              predictedScoreA: p.teamAScore,
              predictedScoreB: p.teamBScore,
              predictedResult: p.predictedResult,
            }))
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
  // Check if we should use mock data
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
