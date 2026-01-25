const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

/**
 * Fetch game schedule from ESPN scoreboard API
 * @param {string} dateRange - Date range in format 'YYYYMMDD-YYYYMMDD'
 * @returns {Promise<Array>} Array of game objects
 */
export async function fetchSchedule(dateRange = '20260211-20260222') {
  const url = `${BASE_URL}/scoreboard?dates=${dateRange}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    return parseScheduleResponse(data);
  } catch (error) {
    console.error('Failed to fetch schedule:', error);
    throw error;
  }
}

/**
 * Parse ESPN schedule response into normalized game objects
 */
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

/**
 * Parse team data from ESPN competitor object
 */
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

/**
 * Parse game status into normalized format
 */
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

/**
 * Determine round type from season type or event name
 */
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

/**
 * Fetch detailed game summary for a specific event
 * @param {string} eventId - ESPN event ID
 * @returns {Promise<Object>} Detailed game summary
 */
export async function fetchGameSummary(eventId) {
  const url = `${BASE_URL}/summary?event=${eventId}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    return parseGameSummary(data, eventId);
  } catch (error) {
    console.error(`Failed to fetch game summary for ${eventId}:`, error);
    throw error;
  }
}

/**
 * Parse game summary response
 */
function parseGameSummary(data, eventId) {
  const boxscore = data.boxscore || {};
  const teams = boxscore.teams || [];

  return {
    espnEventId: eventId,
    teams: teams.map(t => ({
      espnId: t.team?.id,
      name: t.team?.displayName,
      abbreviation: t.team?.abbreviation,
      statistics: t.statistics,
    })),
    scoring: data.scoringPlays || [],
    header: data.header,
  };
}

/**
 * Fetch all teams
 * @returns {Promise<Array>} Array of team objects
 */
export async function fetchTeams() {
  const url = `${BASE_URL}/teams`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    return parseTeamsResponse(data);
  } catch (error) {
    console.error('Failed to fetch teams:', error);
    throw error;
  }
}

/**
 * Parse teams response
 */
function parseTeamsResponse(data) {
  const teams = [];

  const sportTeams = data.sports?.[0]?.leagues?.[0]?.teams || [];

  for (const item of sportTeams) {
    const team = item.team || item;
    teams.push({
      espnId: team.id,
      name: team.displayName || team.name,
      abbreviation: team.abbreviation,
      logo: team.logos?.[0]?.href || team.logo,
      color: team.color,
      alternateColor: team.alternateColor,
    });
  }

  return teams;
}

/**
 * Fetch tournament standings
 * @returns {Promise<Array>} Array of standing objects
 */
export async function fetchStandings() {
  const url = `${BASE_URL}/standings`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    return parseStandingsResponse(data);
  } catch (error) {
    console.error('Failed to fetch standings:', error);
    throw error;
  }
}

/**
 * Parse standings response
 */
function parseStandingsResponse(data) {
  const standings = [];

  const groups = data.children || [];

  for (const group of groups) {
    const groupName = group.name || group.abbreviation;
    const groupStandings = group.standings?.entries || [];

    for (const entry of groupStandings) {
      const team = entry.team || {};
      const stats = {};

      for (const stat of entry.stats || []) {
        stats[stat.name] = stat.value;
      }

      standings.push({
        group: groupName,
        team: {
          espnId: team.id,
          name: team.displayName || team.name,
          abbreviation: team.abbreviation,
          logo: team.logos?.[0]?.href,
        },
        stats: {
          wins: stats.wins || 0,
          losses: stats.losses || 0,
          ties: stats.ties || stats.otLosses || 0,
          points: stats.points || 0,
          gamesPlayed: stats.gamesPlayed || 0,
          goalsFor: stats.pointsFor || 0,
          goalsAgainst: stats.pointsAgainst || 0,
          goalDifferential: stats.differential || stats.pointDifferential || 0,
        },
      });
    }
  }

  return standings;
}

export default {
  fetchSchedule,
  fetchGameSummary,
  fetchTeams,
  fetchStandings,
};
