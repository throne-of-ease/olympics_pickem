import { jsonResponse, errorResponse, handleCors } from './utils/response.js';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  try {
    const response = await fetch(`${ESPN_BASE_URL}/standings`);

    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    const standings = parseStandings(data);

    return jsonResponse(res, {
      standings,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching standings:', error);
    return errorResponse(res, error.message);
  }
}

function parseStandings(data) {
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
