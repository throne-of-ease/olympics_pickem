import { useState, useEffect } from 'react';
import { format, parseISO, isPast } from 'date-fns';
import { Button, Card, CountryFlag } from '../common';
import styles from './PickForm.module.css';

export function PickForm({ game, existingPick, onSubmit, onDelete, loading }) {
  const [teamAScore, setTeamAScore] = useState('');
  const [teamBScore, setTeamBScore] = useState('');
  const [confidence, setConfidence] = useState(0.5);
  const [error, setError] = useState(null);

  const scheduledAt = parseISO(game.scheduled_at);
  const hasStarted = isPast(scheduledAt);
  const isEditing = !!existingPick;

  // Initialize form with existing pick
  useEffect(() => {
    if (existingPick) {
      setTeamAScore(existingPick.team_a_score?.toString() || '');
      setTeamBScore(existingPick.team_b_score?.toString() || '');
      setConfidence(existingPick.confidence ?? 0.5);
    } else {
      setTeamAScore('');
      setTeamBScore('');
      setConfidence(0.5);
    }
  }, [existingPick, game.game_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const scoreA = parseInt(teamAScore, 10);
    const scoreB = parseInt(teamBScore, 10);

    if (isNaN(scoreA) || isNaN(scoreB)) {
      setError('Please enter valid scores');
      return;
    }

    if (scoreA < 0 || scoreB < 0) {
      setError('Scores cannot be negative');
      return;
    }

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
    return (
      <Card className={styles.card}>
        <div className={styles.locked}>
          <span className={styles.lockIcon}>🔒</span>
          <span>Game has started - picks are locked</span>
        </div>
        {existingPick && (
          <div className={styles.submittedPick}>
            <div className={styles.submittedScore}>
              Your pick: {existingPick.team_a_score} - {existingPick.team_b_score}
            </div>
            <div className={styles.submittedConfidence}>
              Confidence: {Math.round(existingPick.confidence * 100)}%
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

        <div className={styles.scores}>
          <div className={styles.scoreInput}>
            <label>{game.team_a?.abbreviation || 'A'}</label>
            <input
              type="number"
              min="0"
              max="99"
              value={teamAScore}
              onChange={(e) => setTeamAScore(e.target.value)}
              placeholder="0"
            />
          </div>
          <span className={styles.dash}>-</span>
          <div className={styles.scoreInput}>
            <label>{game.team_b?.abbreviation || 'B'}</label>
            <input
              type="number"
              min="0"
              max="99"
              value={teamBScore}
              onChange={(e) => setTeamBScore(e.target.value)}
              placeholder="0"
            />
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
