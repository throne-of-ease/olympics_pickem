import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not found. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
  );
}

/**
 * Create a Supabase client with the user's JWT for RLS
 * @param {string} accessToken - User's access token from auth header
 */
export function createSupabaseClient(accessToken = null) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const options = {};

  if (accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  return createClient(supabaseUrl, supabaseAnonKey, options);
}

/**
 * Create a Supabase client with service role key (bypasses RLS)
 * Use only on the backend for admin operations like aggregating all picks
 */
export function createServiceRoleClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('Service role key not configured, falling back to anon client');
    return createSupabaseClient();
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Extract access token from Authorization header
 * @param {object} headers - Request headers
 */
export function getAccessToken(headers) {
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Get authenticated user from request
 * @param {object} headers - Request headers
 */
export async function getAuthenticatedUser(headers) {
  const accessToken = getAccessToken(headers);
  if (!accessToken) {
    return { user: null, supabase: null };
  }

  const supabase = createSupabaseClient(accessToken);
  if (!supabase) {
    return { user: null, supabase: null };
  }

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, supabase };
  }

  return { user, supabase };
}

/**
 * Check if user is admin
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 */
export async function isAdmin(supabase, userId) {
  if (!supabase || !userId) return false;

  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();

  if (error) return false;
  return data?.is_admin === true;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured() {
  return !!(supabaseUrl && supabaseAnonKey);
}

/**
 * Get user's profile
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 */
export async function getProfile(supabase, userId) {
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get all profiles for leaderboard
 * @param {object} supabase - Supabase client
 */
export async function getAllProfiles(supabase) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('name');

  if (error) return [];
  return data;
}

/**
 * Get user's picks
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 */
export async function getUserPicks(supabase, userId) {
  if (!supabase || !userId) return [];

  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .eq('user_id', userId);

  if (error) return [];
  return data;
}

/**
 * Get all picks (respects RLS - only visible picks returned)
 * @param {object} supabase - Supabase client
 */
export async function getAllPicks(supabase) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('picks')
    .select(`
      *,
      profiles (id, name)
    `);

  if (error) return [];
  return data;
}

/**
 * Save a pick (validates game hasn't started)
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID
 * @param {number} teamAScore - Team A score prediction
 * @param {number} teamBScore - Team B score prediction
 * @param {Date} gameStartTime - When the game starts
 */
export async function savePick(supabase, userId, gameId, teamAScore, teamBScore, gameStartTime) {
  if (!supabase || !userId) {
    throw new Error('Not authenticated');
  }

  // Check if game has started
  if (gameStartTime && new Date(gameStartTime) <= new Date()) {
    throw new Error('Cannot modify picks after game has started');
  }

  const { data, error } = await supabase
    .from('picks')
    .upsert(
      {
        user_id: userId,
        game_id: gameId,
        team_a_score: teamAScore,
        team_b_score: teamBScore,
      },
      {
        onConflict: 'user_id,game_id',
      }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a pick (validates game hasn't started)
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID
 * @param {Date} gameStartTime - When the game starts
 */
export async function deletePick(supabase, userId, gameId, gameStartTime) {
  if (!supabase || !userId) {
    throw new Error('Not authenticated');
  }

  // Check if game has started
  if (gameStartTime && new Date(gameStartTime) <= new Date()) {
    throw new Error('Cannot modify picks after game has started');
  }

  const { error } = await supabase
    .from('picks')
    .delete()
    .eq('user_id', userId)
    .eq('game_id', gameId);

  if (error) throw error;
}

/**
 * Get all invites (admin only)
 * @param {object} supabase - Supabase client
 */
export async function getInvites(supabase) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data;
}

/**
 * Create an invite (admin only)
 * @param {object} supabase - Supabase client
 * @param {string} email - Email to invite
 * @param {string} invitedBy - Admin user ID
 */
export async function createInvite(supabase, email, invitedBy) {
  if (!supabase) throw new Error('Supabase not configured');

  // Generate invite code
  const { data: inviteCode, error: codeError } = await supabase
    .rpc('generate_invite_code');

  if (codeError) throw codeError;

  const { data, error } = await supabase
    .from('invites')
    .insert({
      email,
      invite_code: inviteCode,
      invited_by: invitedBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete an invite (admin only)
 * @param {object} supabase - Supabase client
 * @param {string} inviteId - Invite ID
 */
export async function deleteInvite(supabase, inviteId) {
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase
    .from('invites')
    .delete()
    .eq('id', inviteId)
    .eq('used', false);

  if (error) throw error;
}

export default createSupabaseClient;
