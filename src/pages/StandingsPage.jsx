import { useState, useEffect } from 'react';
import { Card, Loading, Button, CountryFlag } from '../components/common';
import styles from './StandingsPage.module.css';

export function StandingsPage() {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStandings = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/standings');
      if (!response.ok) throw new Error('Failed to fetch standings');

      const data = await response.json();
      setStandings(data.standings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStandings();
  }, []);

  if (loading) {
    return <Loading text="Loading standings..." />;
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>Failed to load standings: {error}</p>
        <Button onClick={fetchStandings}>Try Again</Button>
      </div>
    );
  }

  // Group standings by group
  const groups = standings.reduce((acc, entry) => {
    const group = entry.group || 'Unknown';
    if (!acc[group]) acc[group] = [];
    acc[group].push(entry);
    return acc;
  }, {});

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Tournament Standings</h1>
        <Button variant="ghost" size="small" onClick={fetchStandings}>
          Refresh
        </Button>
      </div>

      {Object.keys(groups).length === 0 ? (
        <Card className={styles.empty}>
          <p>Standings will be available once the tournament begins.</p>
        </Card>
      ) : (
        <div className={styles.groups}>
          {Object.entries(groups).map(([groupName, entries]) => (
            <Card key={groupName} className={styles.group} padding="none">
              <h2 className={styles.groupName}>{groupName}</h2>
              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.rank}>#</th>
                      <th className={styles.team}>Team</th>
                      <th>GP</th>
                      <th>W</th>
                      <th>L</th>
                      <th>T</th>
                      <th>GF</th>
                      <th>GA</th>
                      <th>+/-</th>
                      <th className={styles.points}>PTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, index) => (
                      <tr key={entry.team.espnId}>
                        <td className={styles.rank}>{index + 1}</td>
                        <td className={styles.team}>
                          <CountryFlag team={entry.team} size="small" className={styles.flag} />
                          {entry.team.logo && (
                            <img
                              src={entry.team.logo}
                              alt=""
                              className={styles.logo}
                            />
                          )}
                          <span>{entry.team.name}</span>
                        </td>
                        <td>{entry.stats.gamesPlayed}</td>
                        <td>{entry.stats.wins}</td>
                        <td>{entry.stats.losses}</td>
                        <td>{entry.stats.ties}</td>
                        <td>{entry.stats.goalsFor}</td>
                        <td>{entry.stats.goalsAgainst}</td>
                        <td className={getDiffClass(entry.stats.goalDifferential)}>
                          {entry.stats.goalDifferential > 0 ? '+' : ''}
                          {entry.stats.goalDifferential}
                        </td>
                        <td className={styles.points}>{entry.stats.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function getDiffClass(diff) {
  if (diff > 0) return styles.positive;
  if (diff < 0) return styles.negative;
  return '';
}

export default StandingsPage;
