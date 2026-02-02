import { jsonResponse, errorResponse, handleCors } from './utils/response.js';
import {
  getAuthenticatedUser,
  isAdmin,
  getInvites,
  createInvite,
  deleteInvite,
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

    // Check admin status
    const userIsAdmin = await isAdmin(supabase, user.id);
    if (!userIsAdmin) {
      return errorResponse(res, 'Admin access required', 403);
    }

    // Route to appropriate handler
    switch (req.method) {
      case 'GET':
        return handleGetInvites(res, supabase);
      case 'POST':
        return handleCreateInvite(req, res, supabase, user);
      case 'DELETE':
        return handleDeleteInvite(req, res, supabase);
      default:
        return errorResponse(res, 'Method not allowed', 405);
    }
  } catch (error) {
    console.error('Invites API error:', error);
    return errorResponse(res, error.message);
  }
}

/**
 * GET /api/invites - Get all invites (admin only)
 */
async function handleGetInvites(res, supabase) {
  const invites = await getInvites(supabase);

  return jsonResponse(res, {
    invites,
  });
}

/**
 * POST /api/invites - Create a new invite (admin only)
 * Body: { email }
 */
async function handleCreateInvite(req, res, supabase, user) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return errorResponse(res, 'Invalid JSON body', 400);
  }

  const { email } = body;

  if (!email || typeof email !== 'string') {
    return errorResponse(res, 'email is required', 400);
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return errorResponse(res, 'Invalid email format', 400);
  }

  try {
    const invite = await createInvite(supabase, email.toLowerCase(), user.id);

    return jsonResponse(res, {
      success: true,
      invite,
    });
  } catch (error) {
    if (error.code === '23505') {
      return errorResponse(res, 'An invite for this email already exists', 409);
    }
    throw error;
  }
}

/**
 * DELETE /api/invites - Delete an unused invite (admin only)
 * Query params: id
 */
async function handleDeleteInvite(req, res, supabase) {
  const { id } = req.query || {};

  if (!id) {
    return errorResponse(res, 'id is required', 400);
  }

  try {
    await deleteInvite(supabase, id);

    return jsonResponse(res, {
      success: true,
      deleted: id,
    });
  } catch (error) {
    throw error;
  }
}
