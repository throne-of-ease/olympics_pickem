import { format, parseISO } from 'date-fns';
import { Card, CountryFlag } from '../common';
import styles from './GameCard.module.css';

const ROUND_LABELS = {
  groupStage: 'Group Stage',
  knockoutRound: 'Knockout',
  medalRound: 'Medal Round',
};

export function GameCard({ game }) {
  const scheduledAt = parseISO(game.scheduled_at);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'in_progress';

  return (
    <Card className={styles.card} padding="none">
      <div className={styles.header}>
        <span className={`${styles.round} ${styles[game.round_type]}`}>
          {ROUND_LABELS[game.round_type] || 'Group Stage'}
        </span>
        <span className={styles.date}>
          {format(scheduledAt, 'EEE, MMM d')} at {format(scheduledAt, 'h:mm a')}
        </span>
        {isLive && <span className={styles.live}>LIVE</span>}
        {isFinal && <span className={styles.final}>FINAL</span>}
      </div>

      <div className={styles.matchup}>
        <TeamDisplay
          team={game.team_a}
          score={game.score_a}
          isWinner={isFinal && game.result === 'win_a'}
          showScore={isFinal || isLive}
        />
        <div className={styles.vs}>VS</div>
        <TeamDisplay
          team={game.team_b}
          score={game.score_b}
          isWinner={isFinal && game.result === 'win_b'}
          showScore={isFinal || isLive}
        />
      </div>

      {game.picksVisible && game.picks?.length > 0 && (
        <div className={styles.picks}>
          <h4 className={styles.picksTitle}>Predictions</h4>
          <div className={styles.picksList}>
            {game.picks.map((pick) => (
              <PredictionRow key={pick.playerId} pick={pick} game={game} />
            ))}
          </div>
        </div>
      )}

      {!game.picksVisible && game.picks?.length > 0 && (
        <div className={styles.hidden}>
          {game.picks.length} prediction{game.picks.length !== 1 ? 's' : ''} submitted
        </div>
      )}
    </Card>
  );
}

function TeamDisplay({ team, score, isWinner, showScore }) {
  if (!team) {
    return <div className={styles.team}>TBD</div>;
  }

  return (
    <div className={`${styles.team} ${isWinner ? styles.winner : ''}`}>
      <CountryFlag team={team} size="medium" className={styles.flag} />
      {team.logo_url && (
        <img src={team.logo_url} alt="" className={styles.logo} />
      )}
      <span className={styles.teamName}>{team.name}</span>
      {showScore && (
        <span className={styles.score}>{score ?? '-'}</span>
      )}
    </div>
  );
}

function PredictionRow({ pick, game }) {
  const isFinal = game.status === 'final';
  const isCorrect = pick.isCorrect;

  return (
    <div className={`${styles.pickRow} ${isFinal ? (isCorrect ? styles.correct : styles.incorrect) : ''}`}>
      <span className={styles.playerName}>{pick.playerName}</span>
      <span className={styles.prediction}>
        {pick.predictedScoreA} - {pick.predictedScoreB}
      </span>
      {isFinal && (
        <span className={styles.points}>
          {pick.pointsEarned > 0 ? `+${pick.pointsEarned}` : '0'}
        </span>
      )}
    </div>
  );
}

export default GameCard;
