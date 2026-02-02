/**
 * Backwards-compatible games endpoint
 * For new integrations, use /api/tournament-data instead (reduces calls by 50%)
 */

import { jsonResponse, errorResponse, handleCors } from './utils/response.js';
import { loadAllPlayerPicks, loadMockGamesData, loadScoringConfig, loadGameOverrides } from './utils/pickLoader.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
const scoringConfig = loadScoringConfig();

function getResult(scoreA, scoreB) {
  if (scoreA === null || scoreA === undefined || scoreB === null || scoreB === undefined) return null;
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

function applyGameOverrides(games) {
  const overrides = loadGameOverrides();
  if (!overrides.enabled || !overrides.overrides) {
    return games;
  }

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
    const now = new Date();
    let games = await fetchGamesFromESPN();
    games = applyGameOverrides(games);

    const playersWithPicks = loadAllPlayerPicks();
    const picksByGame = {};
    for (const player of playersWithPicks) {
      for (const pick of player.picks || []) {
        if (!picksByGame[pick.gameId]) {
          picksByGame[pick.gameId] = [];
        }
        picksByGame[pick.gameId].push({ ...pick, playerName: player.name });
      }
    }

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
          ? gamePicks.map(p => ({
              playerId: p.playerId,
              playerName: p.playerName,
              predictedScoreA: p.teamAScore,
              predictedScoreB: p.teamBScore,
              predictedResult: p.predictedResult,
              isCorrect: isFinal && actualResult && p.predictedResult === actualResult,
              pointsEarned: (isFinal && actualResult && p.predictedResult === actualResult) ? basePoints : 0,
            }))
          : gamePicks.map(p => ({ playerId: p.playerId, playerName: p.playerName, submitted: true })),
        picksVisible: gameStarted,
        hasAllPicks: gamePicks.length > 0,
      };
    });

    return jsonResponse(res, { games: enrichedGames, timestamp: now.toISOString() });
  } catch (error) {
    console.error('Error fetching games:', error);
    return errorResponse(res, error.message);
  }
}

async function fetchGamesFromESPN() {
  if (USE_MOCK_DATA) {
    return loadMockGames();
  }

  try {
    const dateRange = '20260211-20260222';
    const url = `${ESPN_BASE_URL}/scoreboard?dates=${dateRange}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return loadMockGames();
    }

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
    };
  }).filter(Boolean);
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

  if (typeId === '1' || stateName === 'scheduled') return { state: 'scheduled', detail: status.type?.shortDetail };
  if (typeId === '2' || stateName === 'in progress') return { state: 'in_progress', period: status.period, clock: status.displayClock, detail: status.type?.shortDetail };
  if (typeId === '3' || stateName === 'final') return { state: 'final', detail: status.type?.shortDetail };
  return { state: stateName || 'unknown', detail: status.type?.shortDetail };
}

function parseRoundType(seasonTypeName, eventName) {
  const name = (seasonTypeName || eventName || '').toLowerCase();
  if (name.includes('gold') || name.includes('bronze')) return 'medalRound';
  if (name.includes('semifinal') || name.includes('quarterfinal') || name.includes('knockout')) return 'knockoutRound';
  return 'groupStage';
}
