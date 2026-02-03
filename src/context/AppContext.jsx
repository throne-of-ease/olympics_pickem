import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchSchedule } from '../services/espnApi';
import { picks as picksService, profiles as profilesService } from '../services/supabase';
import { calculateLeaderboard, enrichGamesWithPicks } from '../services/leaderboardCalculator';

const AppContext = createContext(null);

// Cache configuration
const CACHE_KEY = 'olympics-pickem-cache';
const CACHE_TTL = 60000; // 1 minute cache TTL
const SETTINGS_KEY = 'olympics-pickem-settings';

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
 * Get user settings from localStorage
 */
function getSettings() {
  try {
    const settings = localStorage.getItem(SETTINGS_KEY);
    return settings ? JSON.parse(settings) : {};
  } catch (error) {
    console.warn('Failed to read settings:', error);
    return {};
  }
}

/**
 * Save user settings to localStorage
 */
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save settings:', error);
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
  const [includeLiveGames, setIncludeLiveGames] = useState(() => {
    const settings = getSettings();
    return settings.includeLiveGames ?? false;
  });

  /**
   * Fetch all tournament data client-side
   * - ESPN games directly (no function invocation)
   * - Supabase picks via RLS (visible picks only)
   * - Calculate leaderboard locally
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
      // Fetch all data in parallel
      const [espnGames, visiblePicks, allProfiles] = await Promise.all([
        fetchSchedule('20260211-20260222'),
        picksService.getAllVisible(),
        profilesService.getAll(),
      ]);

      console.log('Client-side fetch complete:', {
        games: espnGames.length,
        picks: visiblePicks.length,
        profiles: allProfiles.length,
      });

      // Calculate leaderboard client-side
      const calculatedLeaderboard = calculateLeaderboard(
        espnGames,
        visiblePicks,
        allProfiles,
        undefined,
        { includeLiveGames }
      );

      // Enrich games with pick information
      const enrichedGames = enrichGamesWithPicks(
        espnGames,
        visiblePicks,
        allProfiles,
        undefined,
        { includeLiveGames }
      );

      // Calculate tournament progress
      const totalGames = espnGames.length;
      const completedGames = espnGames.filter(g => g.status?.state === 'final').length;
      const inProgressGames = espnGames.filter(g => g.status?.state === 'in_progress').length;

      const progressData = {
        totalGames,
        completedGames,
        inProgressGames,
        percentComplete: totalGames > 0 ? ((completedGames / totalGames) * 100).toFixed(1) : '0.0',
      };

      // Update state
      setGames(enrichedGames);
      setLeaderboard(calculatedLeaderboard);
      setTournamentProgress(progressData);
      setPlayers(calculatedLeaderboard.map(p => ({
        id: p.playerId,
        name: p.playerName,
      })));
      setLastUpdated(new Date());

      // Cache the response
      setCachedData({
        games: enrichedGames,
        leaderboard: calculatedLeaderboard,
        tournamentProgress: progressData,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
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
  }, [includeLiveGames]);

  /**
   * Legacy fetchGames for backwards compatibility
   * Now uses the combined client-side fetch internally
   */
  const fetchGames = useCallback(async () => {
    await fetchTournamentData();
  }, [fetchTournamentData]);

  /**
   * Legacy fetchLeaderboard for backwards compatibility
   * Now uses the combined client-side fetch internally
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

  /**
   * Toggle live games inclusion in scoring
   */
  const toggleIncludeLiveGames = useCallback((value) => {
    const newValue = value ?? !includeLiveGames;
    setIncludeLiveGames(newValue);
    saveSettings({ ...getSettings(), includeLiveGames: newValue });
    // Recalculation happens automatically via useEffect when includeLiveGames changes
  }, [includeLiveGames]);

  // Track if this is the initial mount
  const isInitialMount = useRef(true);

  // Initial fetch and recalculate when includeLiveGames changes
  useEffect(() => {
    if (isInitialMount.current) {
      // First mount - allow cache usage
      isInitialMount.current = false;
      fetchTournamentData(false);
    } else {
      // Subsequent updates (includeLiveGames changed) - skip cache to recalculate
      fetchTournamentData(true);
    }
  }, [fetchTournamentData]);

  const value = {
    games,
    leaderboard,
    players,
    tournamentProgress,
    loading,
    error,
    lastUpdated,
    includeLiveGames,
    fetchGames,
    fetchLeaderboard,
    refreshAll,
    forceRefresh,
    clearCache,
    toggleIncludeLiveGames,
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
