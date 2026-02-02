/**
 * Utility functions for Vercel API routes
 */

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
}

export function jsonResponse(res, data, statusCode = 200) {
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.setHeader('Content-Type', 'application/json');
  return res.status(statusCode).json(data);
}

export function errorResponse(res, message, statusCode = 500) {
  return jsonResponse(res, { error: message }, statusCode);
}

export function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.status(204).end();
    return true;
  }
  return false;
}
