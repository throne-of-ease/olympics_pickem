/**
 * Admin endpoint to manually override game results for testing
 *
 * POST /api/admin-game-override
 * Body: { gameId, scoreA, scoreB, status }
 *
 * GET /api/admin-game-override
 * Returns current overrides
 *
 * DELETE /api/admin-game-override
 * Body: { gameId } or { clearAll: true }
 */

import { jsonResponse, errorResponse, handleCors } from './utils/response.js';

// In-memory store for game overrides (resets on cold start)
const gameOverrides = new Map();

// Simple admin key check (in production, use proper auth)
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'test-admin-key-2026';

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const apiKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'];

  // Check Bearer token or API key
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7) === ADMIN_KEY;
  }
  return apiKey === ADMIN_KEY;
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (handleCors(req, res)) return;

  // Check authorization
  if (!isAuthorized(req)) {
    return errorResponse(res, 'Unauthorized - provide X-Admin-Key header', 401);
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(res);

      case 'POST':
        return handlePost(req, res);

      case 'DELETE':
        return handleDelete(req, res);

      default:
        return errorResponse(res, 'Method not allowed', 405);
    }
  } catch (error) {
    console.error('Admin game override error:', error);
    return errorResponse(res, error.message);
  }
}

function handleGet(res) {
  const overrides = Object.fromEntries(gameOverrides);
  return jsonResponse(res, {
    message: 'Current game overrides',
    count: gameOverrides.size,
    overrides,
    usage: {
      set: 'POST with { gameId, scoreA, scoreB, status }',
      remove: 'DELETE with { gameId } or { clearAll: true }',
    }
  });
}

function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { gameId, scoreA, scoreB, status } = body;

  if (!gameId) {
    return errorResponse(res, 'gameId is required', 400);
  }

  if (scoreA === undefined || scoreB === undefined) {
    return errorResponse(res, 'scoreA and scoreB are required', 400);
  }

  if (typeof scoreA !== 'number' || typeof scoreB !== 'number') {
    return errorResponse(res, 'scoreA and scoreB must be numbers', 400);
  }

  if (scoreA < 0 || scoreB < 0) {
    return errorResponse(res, 'Scores cannot be negative', 400);
  }

  const validStatuses = ['final', 'in_progress', 'scheduled'];
  const gameStatus = status || 'final';
  if (!validStatuses.includes(gameStatus)) {
    return errorResponse(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const override = {
    gameId,
    scoreA,
    scoreB,
    status: gameStatus,
    result: getResult(scoreA, scoreB),
    createdAt: new Date().toISOString(),
  };

  gameOverrides.set(gameId, override);

  return jsonResponse(res, {
    message: 'Game override saved',
    override,
    totalOverrides: gameOverrides.size,
  });
}

function handleDelete(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  if (body.clearAll) {
    const count = gameOverrides.size;
    gameOverrides.clear();
    return jsonResponse(res, {
      message: 'All overrides cleared',
      clearedCount: count,
    });
  }

  if (body.gameId) {
    const existed = gameOverrides.has(body.gameId);
    gameOverrides.delete(body.gameId);
    return jsonResponse(res, {
      message: existed ? 'Override removed' : 'Override not found',
      gameId: body.gameId,
      removed: existed,
    });
  }

  return errorResponse(res, 'Provide gameId or clearAll: true', 400);
}

function getResult(scoreA, scoreB) {
  if (scoreA > scoreB) return 'win_a';
  if (scoreB > scoreA) return 'win_b';
  return 'tie';
}

// Export overrides getter for use by other endpoints
export function getGameOverrides() {
  return gameOverrides;
}
