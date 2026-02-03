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
        <h2>Scoring: Brier Score</h2>
        <p>
          This tournament uses a <strong>Brier score</strong> system (modeled after FiveThirtyEight). 
          This rewards not only predicting the correct outcome but also how confident you are in that prediction.
        </p>
        <p>
          For each game, you choose the winner and a <strong>Confidence Level</strong> from 50% (toss-up) to 100% (certain).
        </p>

        <div className={styles.exampleHeader}>Example Points (Group Stage):</div>
        <div className={styles.pointsTable}>
          <div className={styles.pointsRow}>
            <span className={styles.round}>100% Correct</span>
            <span className={styles.points}>+25 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>90% Correct</span>
            <span className={styles.points}>+16 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>75% Correct</span>
            <span className={styles.points}>+18.75 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>50% (Any Result)</span>
            <span className={styles.points}>0 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>75% Wrong</span>
            <span className={styles.points}>-31.25 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>90% Wrong</span>
            <span className={styles.points}>-56 pts</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>100% Wrong</span>
            <span className={styles.points}>-75 pts</span>
          </div>
        </div>

        <p className={styles.note}>
          <strong>Formula:</strong> Points = Round Multiplier × (25 - (100 × (Outcome - Confidence)²))
          <br />
          Where Outcome is 1 for correct and 0 for incorrect.
        </p>
      </Card>

      <Card className={styles.section}>
        <h2>Round Multipliers</h2>
        <p>
          Points are multiplied based on the importance of the round:
        </p>
        <div className={styles.pointsTable}>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Group Stage</span>
            <span className={styles.points}>1x</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Knockout Round</span>
            <span className={styles.points}>2x</span>
          </div>
          <div className={styles.pointsRow}>
            <span className={styles.round}>Medal Round</span>
            <span className={styles.points}>3x</span>
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
