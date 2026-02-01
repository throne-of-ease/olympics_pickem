import { createContext, useContext, useState, useEffect, useCallback } from 'react';

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

export function AppProvider({ children }) {
  const [games, setGames] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [tournamentProgress, setTournamentProgress] = useState(null);
  const [loading, setLoading] = useState({ games: false, leaderboard: false });
  const [error, setError] = useState({ games: null, leaderboard: null });
  const [lastUpdated, setLastUpdated] = useState(null);

  /**
   * Fetch all tournament data from combined endpoint
   * Reduces function invocations by 50% (1 call instead of 2)
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

    // Add timeout to prevent indefinite loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('/api/tournament-data', { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to fetch tournament data');

      const data = await response.json();

      // Update state
      setGames(data.games || []);
      setLeaderboard(data.leaderboard || []);
      setTournamentProgress(data.tournamentProgress);
      setPlayers(data.leaderboard?.map(p => ({
        id: p.playerId,
        name: p.playerName,
      })) || []);
      setLastUpdated(new Date(data.timestamp));

      // Cache the response
      setCachedData(data);
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err.name === 'AbortError' ? 'Request timed out' : err.message;
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
