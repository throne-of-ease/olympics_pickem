import { Card } from '../components/common';
import styles from './RulesPage.module.css';

export function RulesPage() {
  return (
    <div className={styles.page}>
      <h1>Rules</h1>

      <Card className={styles.section}>
        <h2>How It Works</h2>
        <p>
          Before the tournament begins, each player submits their predictions for
          every game. Once a game starts, all predictions for that game become
          visible to everyone. Points are awarded based on correct predictions.
        </p>
      </Card>

      <Card className={styles.section}>
        <h2>Scoring</h2>
        <p>
          Points are awarded for correctly predicting the <strong>result</strong> of
          each game (win/loss/tie). You don't need to predict the exact score — just
          who wins or if it's a tie.
        </p>

        <div className={styles.pointsTable}>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Group Stage</span>
            <span className={styles.points}>1 point</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Knockout Round</span>
            <span className={styles.points}>2 points</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Medal Round</span>
            <span className={styles.points}>3 points</span>
          </div>
        </div>
      </Card>

      <Card className={styles.section}>
        <h2>Tournament Rounds</h2>
        <ul className={styles.list}>
          <li><strong>Group Stage:</strong> Group A and Group B games</li>
          <li><strong>Knockout Round:</strong> Quarterfinals and Semifinals</li>
          <li><strong>Medal Round:</strong> Bronze Medal Game and Gold Medal Game</li>
        </ul>
      </Card>

      <Card className={styles.section}>
        <h2>Pick Visibility</h2>
        <p>
          Your predictions are hidden from other players until each game starts.
          Once the puck drops, everyone can see what you predicted for that game.
        </p>
      </Card>

      <Card className={styles.section}>
        <h2>Tiebreakers</h2>
        <p>
          If players are tied on points, the tiebreaker is:
        </p>
        <ol className={styles.list}>
          <li>Total number of correct predictions</li>
          <li>Alphabetical order by name</li>
        </ol>
      </Card>

      <Card className={styles.section}>
        <h2>Skipped Games</h2>
        <p>
          If you don't submit a prediction for a game, you simply receive 0 points
          for that game. There's no penalty — you just miss the opportunity to score.
        </p>
      </Card>
    </div>
  );
}

export default RulesPage;
