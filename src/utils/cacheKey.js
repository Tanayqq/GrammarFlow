const crypto = require('crypto');

/**
 * Generates a SHA-256 hash key for Redis from the systemPrompt and userText.
 * This is the single source of truth for cache-key generation.
 *
 * @param {string} systemPrompt - The system prompt used for the AI request
 * @param {string} userText - The text input provided by the user
 * @returns {string} The Redis cache key
 */
function generateCacheKey(systemPrompt, userText) {
    const combined = `${systemPrompt || ''}:${userText || ''}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return `gf:cache:${hash}`;
}

module.exports = {
    generateCacheKey
};
