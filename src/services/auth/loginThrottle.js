// Wrong passwords are counted per account (not only per IP), so guessing from many addresses is slowed too.
// After MAX_FAILURES wrong tries within the window the account refuses password logins until the window ends.
// Unknown emails are counted the same way, so the answer never shows whether an account exists. A right password clears
// the count. If Redis is down this fails open: login stays available, and the per-IP limiter still applies.
const { createHash } = require('node:crypto');
const { redisConnection } = require('../../queue');

const MAX_FAILURES = 10;
const WINDOW_SECONDS = 900;
const key = email => `gf:loginfail:${createHash('sha256').update(email).digest('hex')}`;
const usable = () => redisConnection.status === 'ready';

// Seconds left in the lock, or 0 when the account may try.
async function lockedFor(email) {
    if (!usable()) return 0;
    try {
        // Count and time left are read in one step: a login that clears the key between two reads would otherwise
        // pair an old count with a new expiry and show a lock that is not real.
        return Number(await redisConnection.eval(
            "local n = tonumber(redis.call('GET', KEYS[1]) or '0'); if n < tonumber(ARGV[1]) then return 0 end; return math.max(1, redis.call('TTL', KEYS[1]))",
            1, key(email), MAX_FAILURES)) || 0;
    } catch { return 0; }
}

async function recordFailure(email) {
    if (!usable()) return;
    try {
        // Count and set the expiry in one step, so a crash between the two cannot leave a lock that never ends.
        await redisConnection.eval(
            "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
            1, key(email), WINDOW_SECONDS);
    } catch { /* fail open */ }
}

async function clear(email) {
    if (!usable()) return;
    try { await redisConnection.del(key(email)); } catch { /* fail open */ }
}

module.exports = { MAX_FAILURES, WINDOW_SECONDS, lockedFor, recordFailure, clear };
