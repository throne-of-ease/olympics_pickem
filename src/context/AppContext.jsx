import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchSchedule } from '../services/espnApi';
import { loadAllPlayerPicks } from '../services/pickLoader';
import { calculateLeaderboard, getResult } from '../services/scoring';
import scoringConfig from '../../config/scoring.json';

const AppContext = createContext(null);

// Cache configuration
const CACHE_KEY = 'olympics-pickem-cache';
const CACHE_TTL = 60000; // 1 minute cache TTL

/**
 * Get cached data from localStorage if still valid
 */
function getCachedData() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        console.log('Using cached tournament data');
        return data;
      }
    }
  } catch (error) {
    console.warn('Failed to read cache:', error);
  }
  return null;
}

/**
 * Save data to localStorage cache
 */
function setCachedData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch (error) {
    console.warn('Failed to write cache:', error);
  }
}

/**
 * Clear the cache (useful for forced refresh)
 */
function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
}

/**
 * Load mock games data as fallback
 */
async function loadMockGames() {
  try {
    const response = await fetch('/data/mock-games.json');
    if (!response.ok) return [];
    const data = await response.json();
    return parseESPNResponse(data);
  } catch (error) {
    console.warn('Failed to load mock games:', error);
    return [];
  }
}

/**
 * Parse ESPN-format response (works for both live API and mock data)
 */
function parseESPNResponse(data) {
  if (!data?.events) return [];

  return data.events.map(event => {
    const competition = event.competitions?.[0];
    if (!competition) return null;

    const competitors = competition.competitors || [];
    const homeTeam = competitors.find(c => c.homeAway === 'home');
    const awayTeam = competitors.find(c => c.homeAway === 'away');

    const parseTeam = (competitor) => {
      const team = competitor?.team || {};
      return {
        espnId: team.id,
        name: team.displayName || team.name,
        abbreviation: team.abbreviation,
        logo: team.logo,
        color: team.color,
        alternateColor: team.alternateColor,
      };
    };

    const parseStatus = (status) => {
      if (!status) return { state: 'unknown' };
      const typeId = status.type?.id;
      const stateName = status.type?.name?.toLowerCase();
      if (typeId === '1' || stateName === 'scheduled') return { state: 'scheduled', detail: status.type?.shortDetail };
      if (typeId === '2' || stateName === 'in progress') return { state: 'in_progress', period: status.period, clock: status.displayClock, detail: status.type?.shortDetail };
      if (typeId === '3' || stateName === 'final') return { state: 'final', detail: status.type?.shortDetail };
      return { state: stateName || 'unknown', detail: status.type?.shortDetail };
    };

    const parseRoundType = (seasonTypeName, eventName) => {
      const name = (seasonTypeName || eventName || '').toLowerCase();
      if (name.includes('gold') || name.includes('bronze')) return 'medalRound';
      if (name.includes('semifinal') || name.includes('quarterfinal') || name.includes('knockout')) return 'knockoutRound';
      return 'groupStage';
    };

    return {
      espnEventId: event.id,
      name: event.name,
      shortName: event.shortName,
      scheduledAt: event.date,
      status: parseStatus(competition.status),
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

/**
 * Enrich games with player picks data
 */
function enrichGamesWithPicks(games, playersWithPicks, now) {
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

  return games.map(game => {
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
}

export function AppProvider({ children }) {
  const [games, setGames] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [tournamentProgress, setTournamentProgress] = useState(null);
  const [loading, setLoading] = useState({ games: false, leaderboard: false });
  const [error, setError] = useState({ games: null, leaderboard: null });
  const [lastUpdated, setLastUpdated] = useState(null);

  /**
   * Fetch all tournament data using client-side services
   * No serverless functions required - calls ESPN API directly from browser
   */
  const fetchTournamentData = useCallback(async (skipCache = false) => {
    // Check cache first (unless forced refresh)
    if (!skipCache) {
      const cached = getCachedData();
      if (cached) {
        setGames(cached.games || []);
        setLeaderboard(cached.leaderboard || []);
        setTournamentProgress(cached.tournamentProgress);
        setPlayers(cached.leaderboard?.map(p => ({
          id: p.playerId,
          name: p.playerName,
        })) || []);
        setLastUpdated(new Date(cached.timestamp));
        return;
      }
    }

    setLoading({ games: true, leaderboard: true });
    setError({ games: null, leaderboard: null });

    try {
      const now = new Date();

      // Fetch games from ESPN API directly (client-side)
      let rawGames;
      try {
        rawGames = await fetchSchedule();
      } catch (espnError) {
        console.warn('ESPN API failed, falling back to mock data:', espnError.message);
        rawGames = null;
      }

      // Fall back to mock data if ESPN returns nothing or fails
      if (!rawGames || rawGames.length === 0) {
        console.log('Using mock games data');
        rawGames = await loadMockGames();
      }

      // Load all player picks from static CSVs (client-side)
      const playersWithPicks = await loadAllPlayerPicks();

      // Enrich games with picks (client-side)
      const enrichedGames = enrichGamesWithPicks(rawGames, playersWithPicks, now);

      // Calculate leaderboard (client-side)
      const leaderboardData = calculateLeaderboard(playersWithPicks, rawGames, scoringConfig);

      // Calculate tournament progress
      const totalGames = rawGames.length;
      const completedGames = rawGames.filter(g => g.status?.state === 'final').length;
      const inProgressGames = rawGames.filter(g => g.status?.state === 'in_progress').length;

      const progress = {
        totalGames,
        completedGames,
        inProgressGames,
        percentComplete: totalGames > 0 ? ((completedGames / totalGames) * 100).toFixed(1) : '0.0',
      };

      // Update state
      setGames(enrichedGames);
      setLeaderboard(leaderboardData);
      setTournamentProgress(progress);
      setPlayers(leaderboardData.map(p => ({
        id: p.playerId,
        name: p.playerName,
      })));
      setLastUpdated(now);

      // Cache the response
      const cacheData = {
        games: enrichedGames,
        leaderboard: leaderboardData,
        tournamentProgress: progress,
        timestamp: now.toISOString(),
      };
      setCachedData(cacheData);
    } catch (err) {
      const message = err.message || 'Failed to fetch tournament data';
      console.error('Error fetching tournament data:', message);
      setError({ games: message, leaderboard: message });

      // Try to use stale cache on error
      const staleCache = getCachedData();
      if (staleCache) {
        console.log('Using stale cache due to fetch error');
        setGames(staleCache.games || []);
        setLeaderboard(staleCache.leaderboard || []);
        setTournamentProgress(staleCache.tournamentProgress);
      }
    } finally {
      setLoading({ games: false, leaderboard: false });
    }
  }, []);

  /**
   * Legacy fetchGames for backwards compatibility
   * Now uses the combined endpoint internally
   */
  const fetchGames = useCallback(async () => {
    await fetchTournamentData();
  }, [fetchTournamentData]);

  /**
   * Legacy fetchLeaderboard for backwards compatibility
   * Now uses the combined endpoint internally
   */
  const fetchLeaderboard = useCallback(async () => {
    await fetchTournamentData();
  }, [fetchTournamentData]);

  /**
   * Refresh all data, optionally bypassing cache
   */
  const refreshAll = useCallback(async (skipCache = false) => {
    if (skipCache) {
      clearCache();
    }
    await fetchTournamentData(skipCache);
  }, [fetchTournamentData]);

  /**
   * Force refresh (bypasses cache)
   */
  const forceRefresh = useCallback(async () => {
    await refreshAll(true);
  }, [refreshAll]);

  // Initial fetch
  useEffect(() => {
    fetchTournamentData();
  }, [fetchTournamentData]);

  const value = {
    games,
    leaderboard,
    players,
    tournamentProgress,
    loading,
    error,
    lastUpdated,
    fetchGames,
    fetchLeaderboard,
    refreshAll,
    forceRefresh,
    clearCache,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export default AppContext;
