import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [games, setGames] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [tournamentProgress, setTournamentProgress] = useState(null);
  const [loading, setLoading] = useState({ games: false, leaderboard: false });
  const [error, setError] = useState({ games: null, leaderboard: null });
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchGames = useCallback(async () => {
    setLoading(prev => ({ ...prev, games: true }));
    setError(prev => ({ ...prev, games: null }));

    try {
      const response = await fetch('/api/games');
      if (!response.ok) throw new Error('Failed to fetch games');

      const data = await response.json();
      setGames(data.games || []);
      setLastUpdated(new Date(data.timestamp));
    } catch (err) {
      console.error('Error fetching games:', err);
      setError(prev => ({ ...prev, games: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, games: false }));
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(prev => ({ ...prev, leaderboard: true }));
    setError(prev => ({ ...prev, leaderboard: null }));

    try {
      const response = await fetch('/api/leaderboard');
      if (!response.ok) throw new Error('Failed to fetch leaderboard');

      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
      setTournamentProgress(data.tournamentProgress);
      setPlayers(data.leaderboard?.map(p => ({
        id: p.playerId,
        name: p.playerName,
      })) || []);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      setError(prev => ({ ...prev, leaderboard: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, leaderboard: false }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchGames(), fetchLeaderboard()]);
  }, [fetchGames, fetchLeaderboard]);

  // Initial fetch
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

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
