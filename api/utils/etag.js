import { createHash } from 'crypto';

/**
 * Generate ETag from data
 * @param {any} data - Data to hash
 * @returns {string} ETag string
 */
export function generateETag(data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = createHash('md5').update(content).digest('hex');
  return `"${hash}"`;
}

/**
 * Check if client has valid cached version
 * @param {Object} req - Request object
 * @param {string} etag - Current ETag
 * @returns {boolean} True if client cache is valid
 */
export function isClientCacheValid(req, etag) {
  const ifNoneMatch = req.headers['if-none-match'];
  return ifNoneMatch === etag;
}

/**
 * Handle ETag caching for API responses
 * Returns true if 304 was sent (client cache is valid)
 *
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {any} data - Response data
 * @param {Object} options - Options
 * @param {number} options.maxAge - Cache-Control max-age in seconds (default: 60)
 * @returns {boolean} True if 304 response was sent
 */
export function handleETagCaching(req, res, data, options = {}) {
  const { maxAge = 60 } = options;
  const etag = generateETag(data);

  // Set caching headers
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);

  // Check if client has valid cache
  if (isClientCacheValid(req, etag)) {
    res.status(304).end();
    return true;
  }

  return false;
}

export default {
  generateETag,
  isClientCacheValid,
  handleETagCaching,
};
