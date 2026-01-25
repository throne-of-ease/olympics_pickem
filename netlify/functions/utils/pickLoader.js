import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

// Get the picks data directory
function getDataDir() {
  // In Netlify functions, picks are in public/data/picks (served as static files)
  // During build, they're in the dist folder, but we need to check multiple locations
  const possiblePaths = [
    join(process.cwd(), 'public', 'data', 'picks'),
    join(process.cwd(), 'dist', 'data', 'picks'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', 'data', 'picks'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return join(process.cwd(), 'public', 'data', 'picks');
}

/**
 * Load players manifest from static JSON file
 * @returns {Array} Array of player objects
 */
export function loadPlayers() {
  const dataDir = getDataDir();
  const manifestPath = join(dataDir, 'players.json');

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    return data.players || [];
  } catch (error) {
    console.error('Failed to load players manifest:', error.message);
    return [];
  }
}

/**
 * Load picks for a single player from their CSV file
 * @param {Object} player - Player object with id property
 * @returns {Array} Array of pick objects
 */
export function loadPlayerPicks(player) {
  const dataDir = getDataDir();
  const fileName = player.id.toLowerCase().replace(/[^a-z0-9]/g, '') + '.csv';
  const filePath = join(dataDir, fileName);

  try {
    if (!existsSync(filePath)) {
      console.warn(`No picks file found for player ${player.name} at ${filePath}`);
      return [];
    }

    const csvText = readFileSync(filePath, 'utf-8');
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      transform: (value) => value.trim(),
    });

    return result.data.map(row => parsePickRow(row, player.id));
  } catch (error) {
    console.error(`Failed to load picks for ${player.name}:`, error.message);
    return [];
  }
}

/**
 * Parse a single pick row from CSV
 */
function parsePickRow(row, playerId) {
  const gameId = row.game_id || row.gameid || row.event_id;
  const teamAScore = parseInt(row.team_a_score || row.teama_score, 10);
  const teamBScore = parseInt(row.team_b_score || row.teamb_score, 10);

  return {
    playerId,
    gameId: gameId?.toString(),
    teamA: row.team_a || row.teama,
    teamAScore: isNaN(teamAScore) ? 0 : teamAScore,
    teamB: row.team_b || row.teamb,
    teamBScore: isNaN(teamBScore) ? 0 : teamBScore,
    predictedResult: getResult(teamAScore, teamBScore),
  };
}

/**
 * Determine the result from scores
 */
function getResult(scoreA, scoreB) {
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

/**
 * Load all players and their picks
 * @returns {Array} Array of player objects with picks attached
 */
export function loadAllPlayerPicks() {
  const players = loadPlayers();

  return players.map((player) => {
    const picks = loadPlayerPicks(player);
    return { ...player, picks };
  });
}

export default {
  loadPlayers,
  loadPlayerPicks,
  loadAllPlayerPicks,
};
