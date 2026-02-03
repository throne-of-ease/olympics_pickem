import { useState, useEffect } from 'react';
import { format, parseISO, isPast } from 'date-fns';
import { Button, Card, CountryFlag } from '../common';
import styles from './PickForm.module.css';

export function PickForm({ game, existingPick, onSubmit, onDelete, loading }) {
  const [teamAScore, setTeamAScore] = useState('');
  const [teamBScore, setTeamBScore] = useState('');
  const [confidence, setConfidence] = useState(0.5);
  const [error, setError] = useState(null);
  const [selectedWinner, setSelectedWinner] = useState(null); // 'a', 'b', or 'tie'

  const scheduledAt = parseISO(game.scheduled_at);
  const hasStarted = isPast(scheduledAt);
  const isEditing = !!existingPick;

  // Initialize form with existing pick
  useEffect(() => {
    if (existingPick) {
      setTeamAScore(existingPick.team_a_score?.toString() || '');
      setTeamBScore(existingPick.team_b_score?.toString() || '');
      setConfidence(existingPick.confidence ?? 0.5);
      // Determine winner from scores
      const a = existingPick.team_a_score ?? 0;
      const b = existingPick.team_b_score ?? 0;
      if (a > b) setSelectedWinner('a');
      else if (b > a) setSelectedWinner('b');
      else setSelectedWinner('tie');
    } else {
      setTeamAScore('');
      setTeamBScore('');
      setConfidence(0.5);
      setSelectedWinner(null);
    }
  }, [existingPick, game.game_id]);

  // Quick pick handler - select a winner with default scores
  const handleQuickPick = (winner) => {
    setSelectedWinner(winner);
    if (winner === 'a') {
      setTeamAScore('3');
      setTeamBScore('1');
    } else if (winner === 'b') {
      setTeamAScore('1');
      setTeamBScore('3');
    } else {
      setTeamAScore('2');
      setTeamBScore('2');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!selectedWinner) {
      setError('Please select a winner');
      return;
    }

    const scoreA = parseInt(teamAScore, 10);
    const scoreB = parseInt(teamBScore, 10);

    try {
      await onSubmit(game.game_id, scoreA, scoreB, confidence);
    } catch (err) {
      setError(err.message || 'Failed to save pick');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remove your prediction for this game?')) return;

    try {
      await onDelete(game.game_id);
      setTeamAScore('');
      setTeamBScore('');
    } catch (err) {
      setError(err.message || 'Failed to delete pick');
    }
  };

  if (hasStarted) {
    const pickedWinner = existingPick ? (
      existingPick.team_a_score > existingPick.team_b_score ? game.team_a?.name :
      existingPick.team_b_score > existingPick.team_a_score ? game.team_b?.name :
      'Tie'
    ) : null;

    return (
      <Card className={styles.card}>
        <div className={styles.locked}>
          <span className={styles.lockIcon}>🔒</span>
          <span>Game has started - picks are locked</span>
        </div>
        {existingPick && (
          <div className={styles.submittedPick}>
            <div className={styles.submittedScore}>
              Your pick: {pickedWinner}
            </div>
            <div className={styles.submittedConfidence}>
              Confidence: {Math.round((existingPick.confidence ?? 0.5) * 100)}%
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <div className={styles.gameInfo}>
        <div className={styles.teams}>
          <div className={styles.team}>
            <CountryFlag team={game.team_a} size="small" />
            <span>{game.team_a?.name || 'TBD'}</span>
          </div>
          <span className={styles.vs}>vs</span>
          <div className={styles.team}>
            <CountryFlag team={game.team_b} size="small" />
            <span>{game.team_b?.name || 'TBD'}</span>
          </div>
        </div>
        <div className={styles.time}>
          {format(scheduledAt, 'EEE, MMM d')} at {format(scheduledAt, 'h:mm a')}
        </div>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.quickPick}>
          <span className={styles.quickPickLabel}>Pick winner:</span>
          <div className={styles.quickPickButtons}>
            <button
              type="button"
              className={`${styles.quickPickBtn} ${selectedWinner === 'a' ? styles.selected : ''}`}
              onClick={() => handleQuickPick('a')}
            >
              <CountryFlag team={game.team_a} size="small" />
              <span>{game.team_a?.abbreviation || game.team_a?.name || 'A'}</span>
            </button>
            <button
              type="button"
              className={`${styles.quickPickBtn} ${styles.tieBtn} ${selectedWinner === 'tie' ? styles.selected : ''}`}
              onClick={() => handleQuickPick('tie')}
            >
              TIE
            </button>
            <button
              type="button"
              className={`${styles.quickPickBtn} ${selectedWinner === 'b' ? styles.selected : ''}`}
              onClick={() => handleQuickPick('b')}
            >
              <CountryFlag team={game.team_b} size="small" />
              <span>{game.team_b?.abbreviation || game.team_b?.name || 'B'}</span>
            </button>
          </div>
        </div>

        <div className={styles.confidenceSection}>
          <label className={styles.confidenceLabel}>
            Confidence: {Math.round(confidence * 100)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.01"
            value={confidence}
            onChange={(e) => setConfidence(parseFloat(e.target.value))}
            className={styles.slider}
          />
          <div className={styles.sliderLabels}>
            <span>Toss-up (50%)</span>
            <span>Certain (100%)</span>
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" loading={loading} size="small">
            {isEditing ? 'Update Pick' : 'Submit Pick'}
          </Button>
          {isEditing && (
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={handleDelete}
              disabled={loading}
            >
              Remove
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export default PickForm;
