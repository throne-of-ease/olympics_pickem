import { useState, useMemo } from 'react';
import { format, parseISO, isAfter } from 'date-fns';
import { useGames } from '../hooks/useGames';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { Button, CountryFlag, Loading } from '../components/common';
import { usePolling } from '../hooks/usePolling';
import styles from './PicksOverviewPage.module.css';

const DESIGN_OPTIONS = [
  { id: 'compact', label: 'Compact Table' },
  { id: 'cards', label: 'Card Grid' },
  { id: 'timeline', label: 'Timeline' },
];

export function PicksOverviewPage() {
  const { games, loading: gamesLoading, error: gamesError, refresh: refreshGames } = useGames();
  const { leaderboard, loading: lbLoading, error: lbError, refresh: refreshLb } = useLeaderboard();
  const [design, setDesign] = useState('compact');

  const loading = gamesLoading || lbLoading;
  const error = gamesError || lbError;

  // Auto-refresh every 60 seconds
  usePolling(() => { refreshGames(); refreshLb(); }, 60000, true);

  // Sort players by total points (leader first)
  const sortedPlayers = useMemo(() => {
    return [...leaderboard].sort((a, b) => b.totalPoints - a.totalPoints);
  }, [leaderboard]);

  // Sort games by date (most recent/upcoming first for better UX)
  const sortedGames = useMemo(() => {
    return [...games].sort((a, b) => {
      const dateA = parseISO(a.scheduled_at);
      const dateB = parseISO(b.scheduled_at);
      return dateA - dateB;
    });
  }, [games]);

  const refresh = () => {
    refreshGames();
    refreshLb();
  };

  if (error) {
    return (
      <div className={styles.error}>
        <p>Failed to load data: {error}</p>
        <Button onClick={refresh}>Try Again</Button>
      </div>
    );
  }

  if (loading && games.length === 0) {
    return <Loading />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Picks Overview</h1>
        <div className={styles.controls}>
          <div className={styles.designToggle}>
            {DESIGN_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`${styles.toggleBtn} ${design === opt.id ? styles.active : ''}`}
                onClick={() => setDesign(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="small" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {design === 'compact' && (
        <CompactTableView games={sortedGames} players={sortedPlayers} />
      )}
      {design === 'cards' && (
        <CardGridView games={sortedGames} players={sortedPlayers} />
      )}
      {design === 'timeline' && (
        <TimelineView games={sortedGames} players={sortedPlayers} />
      )}
    </div>
  );
}

// ============================================
// DESIGN 1: Compact Table View
// ============================================
function CompactTableView({ games, players }) {
  // Get abbreviated name (e.g., "Jirka P" -> "JP", "Honza" -> "H")
  const getInitials = (name) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return parts[0][0] + parts[1][0];
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.compactTable}>
        <thead>
          <tr>
            <th className={styles.gameCol}>Game</th>
            {players.map((player, idx) => (
              <th key={player.playerId} className={styles.playerCol}>
                <div className={styles.playerHeader}>
                  <span className={styles.playerName}>{player.playerName}</span>
                  <span className={styles.playerInitials}>{getInitials(player.playerName)}</span>
                  <span className={`${styles.playerPoints} ${idx === 0 ? styles.leader : ''}`}>
                    {player.totalPoints}
                  </span>
                  {idx > 0 && (
                    <span className={styles.pointsDiff}>
                      {player.totalPoints - players[0].totalPoints}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <CompactTableRow key={game.id} game={game} players={players} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompactTableRow({ game, players }) {
  const scheduledAt = parseISO(game.scheduled_at);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'in_progress';
  const now = new Date();
  const gameStarted = isAfter(now, scheduledAt) || isLive || isFinal;

  const getPickForPlayer = (playerId) => {
    return game.picks?.find(p => p.playerId === playerId);
  };

  const getAbbrev = (team) => team?.abbreviation || team?.name?.slice(0, 3).toUpperCase() || '?';

  return (
    <tr className={`${styles.gameRow} ${isLive ? styles.liveRow : ''}`}>
      <td className={styles.gameCell}>
        <div className={styles.gameInfo}>
          <div className={styles.teams}>
            <TeamBadge team={game.team_a} isWinner={isFinal && game.result === 'win_a'} />
            <span className={styles.teamAbbrev}>{getAbbrev(game.team_a)}</span>
            <span className={styles.scoreInline}>
              {(isFinal || isLive) ? `${game.score_a}-${game.score_b}` : 'vs'}
            </span>
            <span className={styles.teamAbbrev}>{getAbbrev(game.team_b)}</span>
            <TeamBadge team={game.team_b} isWinner={isFinal && game.result === 'win_b'} />
          </div>
          <div className={styles.gameTime}>
            {isLive && <span className={styles.liveBadge}>LIVE</span>}
            {isFinal && <span className={styles.finalBadge}>FIN</span>}
            {!isFinal && !isLive && (
              <span>{format(scheduledAt, 'd/M HH:mm')}</span>
            )}
          </div>
        </div>
      </td>
      {players.map((player) => {
        const pick = getPickForPlayer(player.playerId);
        return (
          <td key={player.playerId} className={styles.pickCell}>
            {gameStarted && pick ? (
              <PickDisplay pick={pick} game={game} variant="compact" />
            ) : gameStarted && !pick ? (
              <span className={styles.noPick}>-</span>
            ) : (
              <span className={styles.hidden}>?</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ============================================
// DESIGN 2: Card Grid View (Glassmorphism)
// ============================================
function CardGridView({ games, players }) {
  return (
    <div className={styles.cardGrid}>
      {/* Player Score Cards */}
      <div className={styles.playerCards}>
        {players.map((player, idx) => (
          <div
            key={player.playerId}
            className={`${styles.playerCard} ${idx === 0 ? styles.leaderCard : ''}`}
          >
            <div className={styles.cardRank}>#{idx + 1}</div>
            <div className={styles.cardName}>{player.playerName}</div>
            <div className={styles.cardScore}>{player.totalPoints}</div>
            <div className={styles.cardAccuracy}>{player.accuracy}% accuracy</div>
          </div>
        ))}
      </div>

      {/* Game Cards */}
      <div className={styles.gameCards}>
        {games.map((game) => (
          <GamePickCard key={game.id} game={game} players={players} />
        ))}
      </div>
    </div>
  );
}

function GamePickCard({ game, players }) {
  const scheduledAt = parseISO(game.scheduled_at);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'in_progress';
  const now = new Date();
  const gameStarted = isAfter(now, scheduledAt) || isLive || isFinal;

  const getPickForPlayer = (playerId) => {
    return game.picks?.find(p => p.playerId === playerId);
  };

  return (
    <div className={`${styles.gamePickCard} ${isLive ? styles.liveCard : ''} ${isFinal ? styles.finalCard : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardMatchup}>
          <TeamBadge team={game.team_a} isWinner={isFinal && game.result === 'win_a'} showName />
          <div className={styles.cardVs}>
            {(isFinal || isLive) ? (
              <span className={styles.cardActualScore}>{game.score_a} - {game.score_b}</span>
            ) : (
              <span className={styles.cardVsText}>VS</span>
            )}
          </div>
          <TeamBadge team={game.team_b} isWinner={isFinal && game.result === 'win_b'} showName />
        </div>
        <div className={styles.cardStatus}>
          {isLive && <span className={styles.livePulse}>LIVE</span>}
          {isFinal && <span className={styles.finalLabel}>FINAL</span>}
          {!isFinal && !isLive && (
            <span className={styles.cardTime}>{format(scheduledAt, 'MMM d, HH:mm')}</span>
          )}
        </div>
      </div>
      <div className={styles.cardPicks}>
        {players.map((player) => {
          const pick = getPickForPlayer(player.playerId);
          return (
            <div key={player.playerId} className={styles.cardPickItem}>
              <span className={styles.cardPickPlayer}>{player.playerName}</span>
              {gameStarted && pick ? (
                <PickDisplay pick={pick} game={game} variant="card" />
              ) : gameStarted && !pick ? (
                <span className={styles.cardNoPick}>No pick</span>
              ) : (
                <span className={styles.cardHidden}>Hidden</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// DESIGN 3: Timeline View
// ============================================
function TimelineView({ games, players }) {
  // Group games by date
  const gamesByDate = useMemo(() => {
    const grouped = {};
    games.forEach(game => {
      const date = format(parseISO(game.scheduled_at), 'yyyy-MM-dd');
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(game);
    });
    return grouped;
  }, [games]);

  return (
    <div className={styles.timeline}>
      {/* Floating Player Legend */}
      <div className={styles.playerLegend}>
        {players.map((player, idx) => (
          <div
            key={player.playerId}
            className={`${styles.legendItem} ${idx === 0 ? styles.legendLeader : ''}`}
          >
            <span className={styles.legendName}>{player.playerName}</span>
            <span className={styles.legendPoints}>{player.totalPoints} pts</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className={styles.timelineContent}>
        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className={styles.timelineDay}>
            <div className={styles.timelineDate}>
              <span className={styles.dateBubble}>
                {format(parseISO(date), 'EEE, MMM d')}
              </span>
            </div>
            <div className={styles.timelineGames}>
              {dateGames.map((game) => (
                <TimelineGameRow key={game.id} game={game} players={players} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineGameRow({ game, players }) {
  const scheduledAt = parseISO(game.scheduled_at);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'in_progress';
  const now = new Date();
  const gameStarted = isAfter(now, scheduledAt) || isLive || isFinal;

  const getPickForPlayer = (playerId) => {
    return game.picks?.find(p => p.playerId === playerId);
  };

  return (
    <div className={`${styles.timelineGame} ${isLive ? styles.timelineLive : ''}`}>
      <div className={styles.timelineTime}>
        {isLive && <span className={styles.timelineLiveDot} />}
        <span>{format(scheduledAt, 'HH:mm')}</span>
      </div>

      <div className={styles.timelineMatchup}>
        <div className={styles.timelineTeams}>
          <TeamBadge team={game.team_a} isWinner={isFinal && game.result === 'win_a'} showFlag />
          <span className={styles.timelineVs}>
            {(isFinal || isLive) ? `${game.score_a}-${game.score_b}` : 'vs'}
          </span>
          <TeamBadge team={game.team_b} isWinner={isFinal && game.result === 'win_b'} showFlag />
        </div>
        {(isFinal || isLive) && (
          <span className={`${styles.timelineStatus} ${isLive ? styles.live : ''}`}>
            {isLive ? 'LIVE' : 'FINAL'}
          </span>
        )}
      </div>

      <div className={styles.timelinePicks}>
        {players.map((player) => {
          const pick = getPickForPlayer(player.playerId);
          return (
            <div key={player.playerId} className={styles.timelinePickSlot}>
              {gameStarted && pick ? (
                <PickDisplay pick={pick} game={game} variant="timeline" />
              ) : gameStarted && !pick ? (
                <span className={styles.timelineNoPick}>-</span>
              ) : (
                <span className={styles.timelineHidden}>?</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Shared Components
// ============================================
function TeamBadge({ team, isWinner, showName = false, showFlag = false }) {
  if (!team) {
    return <span className={styles.tbd}>TBD</span>;
  }

  return (
    <div className={`${styles.teamBadge} ${isWinner ? styles.winnerBadge : ''}`}>
      {showFlag && <CountryFlag team={team} size="small" />}
      {team.logo_url && (
        <img src={team.logo_url} alt="" className={styles.teamLogo} />
      )}
      {showName && <span className={styles.teamNameBadge}>{team.abbreviation || team.name?.slice(0, 3).toUpperCase()}</span>}
    </div>
  );
}

function PickDisplay({ pick, game, variant }) {
  const isFinal = game.status === 'final';
  const isCorrect = pick.isCorrect;
  const predictedWinner = pick.predictedResult === 'win_a' ? game.team_a :
                          pick.predictedResult === 'win_b' ? game.team_b : null;

  const baseClass = variant === 'compact' ? styles.pickCompact :
                    variant === 'card' ? styles.pickCard :
                    styles.pickTimeline;

  const resultClass = isFinal ? (isCorrect ? styles.correct : styles.incorrect) : '';

  if (variant === 'compact') {
    return (
      <div className={`${baseClass} ${resultClass}`}>
        {predictedWinner ? (
          <>
            {predictedWinner.logo_url && (
              <img src={predictedWinner.logo_url} alt="" className={styles.pickLogo} />
            )}
            {isFinal && (
              <span className={styles.pickPoints}>
                {pick.pointsEarned > 0 ? `+${pick.pointsEarned}` : '0'}
              </span>
            )}
          </>
        ) : (
          <span className={styles.pickTie}>TIE</span>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`${baseClass} ${resultClass}`}>
        <span className={styles.cardPickScore}>
          {pick.predictedScoreA} - {pick.predictedScoreB}
        </span>
        {isFinal && (
          <span className={styles.cardPickPoints}>
            {pick.pointsEarned > 0 ? `+${pick.pointsEarned}` : '0'}
          </span>
        )}
      </div>
    );
  }

  // timeline
  return (
    <div className={`${baseClass} ${resultClass}`}>
      {predictedWinner?.logo_url && (
        <img src={predictedWinner.logo_url} alt="" className={styles.timelinePickLogo} />
      )}
      {!predictedWinner && <span className={styles.timelineTie}>T</span>}
      {isFinal && pick.pointsEarned > 0 && (
        <span className={styles.timelinePoints}>+{pick.pointsEarned}</span>
      )}
    </div>
  );
}

export default PicksOverviewPage;
