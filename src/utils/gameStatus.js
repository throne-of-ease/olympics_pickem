export function getFinalLabel(game) {
  const statusState = typeof game?.status === 'string' ? game.status : game?.status?.state;
  if (statusState !== 'final') {
    return null;
  }

  const detailRaw = game?.status_detail ?? game?.status?.detail ?? '';
  const detail = String(detailRaw).toLowerCase();

  if (detail) {
    const hasShootout = detail.includes('shootout') || /(^|[^a-z])so([^a-z]|$)/.test(detail);
    if (hasShootout) {
      return 'FINAL/SO';
    }

    const hasOvertime = detail.includes('overtime') || /(^|[^a-z])ot([^a-z]|$)/.test(detail);
    if (hasOvertime) {
      return 'FINAL/OT';
    }
  }

  return 'FINAL';
}
