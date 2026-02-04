import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, isPast } from 'date-fns';
import { Button, Card, CountryFlag } from '../common';
import { calculateBrierPoints } from '../../services/scoring';
import scoringConfig from '../../../config/scoring.json';
import styles from './PickForm.module.css';

export function PickForm({ game, existingPick, onSubmit, onDelete, loading }) {
  const [selectedTeam, setSelectedTeam] = useState(null); // 'team_a' or 'team_b'
  const [confidence, setConfidence] = useState(0.5);
  const [error, setError] = useState(null);

  const scheduledAt = parseISO(game.scheduled_at);
  const hasStarted = isPast(scheduledAt);
  const isEditing = !!existingPick;

  // Derive selected team from existing pick scores
  const getSelectedTeamFromPick = (pick) => {
    if (!pick) return null;
    const scoreA = pick.team_a_score;
    const scoreB = pick.team_b_score;
    if (scoreA > scoreB) return 'team_a';
    if (scoreB > scoreA) return 'team_b';
    // Legacy tie picks - user needs to re-select
    return null;
  };

  // Calculate points preview for both teams based on confidence
  const pointsPreview = useMemo(() => {
    const roundMultiplier = scoringConfig.points[game.roundType || game.round_type || 'groupStage'] || 1;
    const winPoints = calculateBrierPoints(true, confidence, roundMultiplier, scoringConfig);
    const losePoints = calculateBrierPoints(false, confidence, roundMultiplier, scoringConfig);
    return { winPoints, losePoints };
  }, [confidence, game]);

  // Initialize form with existing pick
  useEffect(() => {
    if (existingPick) {
      setSelectedTeam(getSelectedTeamFromPick(existingPick));
      setConfidence(existingPick.confidence ?? 0.5);
    } else {
      setSelectedTeam(null);
      setConfidence(0.5);
    }
  }, [existingPick, game.game_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!selectedTeam) {
      setError('Please select a winner');
      return;
    }

    // Convert team selection to scores for storage
    // These are representative scores - actual scoring uses Brier formula
    let teamAScore, teamBScore;
    if (selectedTeam === 'team_a') {
      teamAScore = 1;
      teamBScore = 0;
    } else {
      teamAScore = 0;
      teamBScore = 1;
    }

    try {
      await onSubmit(game.game_id, teamAScore, teamBScore, confidence);
    } catch (err) {
      setError(err.message || 'Failed to save pick');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remove your prediction for this game?')) return;

    try {
      await onDelete(game.game_id);
      setSelectedTeam(null);
      setConfidence(0.5);
    } catch (err) {
      setError(err.message || 'Failed to delete pick');
    }
  };

  const getTeamDisplayName = (teamKey) => {
    const team = teamKey === 'team_a' ? game.team_a : game.team_b;
    return team?.name || team?.abbreviation || 'TBD';
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
            <div className={styles.submittedTeam}>
              Your pick: {' '}
              {getSelectedTeamFromPick(existingPick)
                ? getTeamDisplayName(getSelectedTeamFromPick(existingPick))
                : 'Not set'}
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
      <div className={styles.time}>
        {format(scheduledAt, 'EEE, MMM d')} at {format(scheduledAt, 'h:mm a')}
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.teamSelection}>
          <div className={styles.pointsHint}>
            <span className={styles.winPoints}>+{pointsPreview.winPoints}</span>
            <span className={styles.losePoints}>{pointsPreview.losePoints}</span>
          </div>

          <button
            type="button"
            className={`${styles.teamButton} ${selectedTeam === 'team_a' ? styles.selected : ''}`}
            onClick={() => setSelectedTeam('team_a')}
          >
            <CountryFlag team={game.team_a} size="medium" />
            <span className={styles.teamButtonName}>{game.team_a?.abbreviation || game.team_a?.name || 'A'}</span>
          </button>

          <span className={styles.vs}>vs</span>

          <button
            type="button"
            className={`${styles.teamButton} ${selectedTeam === 'team_b' ? styles.selected : ''}`}
            onClick={() => setSelectedTeam('team_b')}
          >
            <CountryFlag team={game.team_b} size="medium" />
            <span className={styles.teamButtonName}>{game.team_b?.abbreviation || game.team_b?.name || 'B'}</span>
          </button>

          <div className={styles.pointsHint}>
            <span className={styles.winPoints}>+{pointsPreview.winPoints}</span>
            <span className={styles.losePoints}>{pointsPreview.losePoints}</span>
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
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <div className={styles.actions}>
          <Button type="submit" loading={loading} size="small" disabled={!selectedTeam}>
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
