import { jsonResponse, errorResponse, handleCors } from './utils/response.js';
import {
  getAuthenticatedUser,
  getUserPicks,
  savePick,
  deletePick,
  isSupabaseConfigured,
} from './utils/supabase.js';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (handleCors(req, res)) return;

  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    return errorResponse(res, 'Database not configured', 503);
  }

  try {
    // Get authenticated user
    const { user, supabase } = await getAuthenticatedUser(req.headers);

    if (!user) {
      return errorResponse(res, 'Authentication required', 401);
    }

    // Route to appropriate handler
    switch (req.method) {
      case 'GET':
        return handleGetPicks(res, supabase, user);
      case 'POST':
      case 'PUT':
        return handleSavePick(req, res, supabase, user);
      case 'DELETE':
        return handleDeletePick(req, res, supabase, user);
      default:
        return errorResponse(res, 'Method not allowed', 405);
    }
  } catch (error) {
    console.error('Picks API error:', error);
    return errorResponse(res, error.message);
  }
}

/**
 * GET /api/picks - Get user's picks
 */
async function handleGetPicks(res, supabase, user) {
  const picks = await getUserPicks(supabase, user.id);

  return jsonResponse(res, {
    picks,
    userId: user.id,
  });
}

/**
 * POST/PUT /api/picks - Save or update a pick
 * Body: { gameId, teamAScore, teamBScore, gameStartTime }
 */
async function handleSavePick(req, res, supabase, user) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return errorResponse(res, 'Invalid JSON body', 400);
  }

  const { gameId, teamAScore, teamBScore, gameStartTime } = body;

  // Validate required fields
  if (!gameId) {
    return errorResponse(res, 'gameId is required', 400);
  }

  if (typeof teamAScore !== 'number' || typeof teamBScore !== 'number') {
    return errorResponse(res, 'teamAScore and teamBScore must be numbers', 400);
  }

  if (teamAScore < 0 || teamBScore < 0) {
    return errorResponse(res, 'Scores cannot be negative', 400);
  }

  try {
    const pick = await savePick(
      supabase,
      user.id,
      gameId,
      teamAScore,
      teamBScore,
      gameStartTime
    );

    return jsonResponse(res, {
      success: true,
      pick,
    });
  } catch (error) {
    if (error.message.includes('game has started')) {
      return errorResponse(res, 'Cannot modify picks after game has started', 403);
    }
    throw error;
  }
}

/**
 * DELETE /api/picks - Delete a pick
 * Query params: gameId, gameStartTime
 */
async function handleDeletePick(req, res, supabase, user) {
  const { gameId, gameStartTime } = req.query || {};

  if (!gameId) {
    return errorResponse(res, 'gameId is required', 400);
  }

  try {
    await deletePick(supabase, user.id, gameId, gameStartTime);

    return jsonResponse(res, {
      success: true,
      deleted: gameId,
    });
  } catch (error) {
    if (error.message.includes('game has started')) {
      return errorResponse(res, 'Cannot modify picks after game has started', 403);
    }
    throw error;
  }
}
