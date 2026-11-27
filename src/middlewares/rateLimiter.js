const { randomUUID } = require('node:crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { redisConnection } = require('../queue');
const { shortId } = require('../utils/logSafe');

// After Redis refuses for quota reasons we use memory, then try Redis again after this long (a restart is not needed).
const REDIS_RETRY_MS = 10 * 60 * 1000;
let redisDisabledUntil = 0;

/**
 * Custom Sliding Window Store for express-rate-limit.
 * Uses a Sorted Set (ZSET) in Upstash Redis via the existing ioredis connection.
 * Resiliently falls back to an in-memory sliding window map during Redis outages.
 */
class SlidingWindowStore {
    constructor(windowMs) {
        this.windowMs = windowMs;
        this.memoryStore = new Map();
        this.limit = 100;
        this.nextCleanup = 0;
    }

    init(options) {
        if (options && options.windowMs) {
            this.windowMs = options.windowMs;
        }
        if (typeof options?.limit === 'number') this.limit = options.limit;
    }

    async increment(key) {
        const now = Date.now();
        const windowMs = this.windowMs;

        // Try Redis first if it's connected and not limit-exceeded
        if (Date.now() >= redisDisabledUntil && redisConnection && redisConnection.status === 'ready') {
            try {
                const luaScript = `
                    local key = KEYS[1]
                    local now = tonumber(ARGV[1])
                    local windowMs = tonumber(ARGV[2])
                    local clearBefore = now - windowMs

                    -- Clean expired entries
                    redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)
                    
                    -- Add current request timestamp
                    redis.call('ZADD', key, now, ARGV[3])
                    
                    -- Count total hits in the current sliding window
                    local totalHits = redis.call('ZCARD', key)
                    
                    -- Set long TTL to clean up idle keys (2 * windowMs)
                    redis.call('PEXPIRE', key, windowMs * 2)

                    -- Find oldest entry in the window to calculate resetTime
                    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
                    local oldestTime = now
                    if oldest and oldest[1] then
                        oldestTime = tonumber(oldest[2])
                    end
                    local resetTime = oldestTime + windowMs

                    return {totalHits, resetTime}
                `;
                
                const result = await redisConnection.eval(
                    luaScript,
                    1,
                    key,
                    now,
                    windowMs,
                    randomUUID()
                );
                
                return {
                    totalHits: result[0],
                    resetTime: new Date(result[1])
                };
            } catch (err) {
                if (err.message && err.message.includes('max requests limit exceeded')) {
                    redisDisabledUntil = Date.now() + REDIS_RETRY_MS;
                    console.warn('[RATE LIMITER] Upstash limit exceeded. Using the in-memory limiter for 10 minutes, then trying Redis again.');
                } else {
                    console.error(`[RATE LIMITER REDIS ERROR] Failed to increment key "${key}" in Redis:`, err.message);
                }
                // Fall back to memory below
            }
        }

        // Resilient in-memory fallback
        return this.incrementMemory(key, now, windowMs);
    }

    incrementMemory(key, now, windowMs) {
        if (now >= this.nextCleanup) {
            for (const [id, values] of this.memoryStore) {
                if (!values.length || values[values.length - 1] <= now - windowMs) this.memoryStore.delete(id);
            }
            this.nextCleanup = now + windowMs;
        }
        // Fail closed under a flood of new identifiers instead of growing memory without a bound.
        if (!this.memoryStore.has(key) && this.memoryStore.size >= 10000) {
            return { totalHits: this.limit + 1, resetTime: new Date(now + windowMs) };
        }
        let timestamps = this.memoryStore.get(key) || [];
        const clearBefore = now - windowMs;
        
        // Filter out expired timestamps
        timestamps = timestamps.filter(t => t > clearBefore);
        
        // Add current timestamp
        if (timestamps.length <= this.limit) timestamps.push(now);
        this.memoryStore.set(key, timestamps);

        const oldestTime = timestamps[0] || now;
        
        return {
            totalHits: timestamps.length,
            resetTime: new Date(oldestTime + windowMs)
        };
    }

    async decrement(key) {
        if (Date.now() >= redisDisabledUntil && redisConnection && redisConnection.status === 'ready') {
            try {
                await redisConnection.zremrangebyrank(key, -1, -1);
                return;
            } catch (err) {
                console.error(`[RATE LIMITER REDIS ERROR] Failed to decrement key "${key}" in Redis:`, err.message);
            }
        }

        let timestamps = this.memoryStore.get(key) || [];
        if (timestamps.length > 0) {
            timestamps.pop();
            this.memoryStore.set(key, timestamps);
        }
    }

    async resetKey(key) {
        if (Date.now() >= redisDisabledUntil && redisConnection && redisConnection.status === 'ready') {
            try {
                await redisConnection.del(key);
                return;
            } catch (err) {
                console.error(`[RATE LIMITER REDIS ERROR] Failed to reset key "${key}" in Redis:`, err.message);
            }
        }
        this.memoryStore.delete(key);
    }
}

/**
 * Resolves user identifier in order:
 * Verified user ID, otherwise normalized IP. A caller-controlled guest header
 * must not allow an attacker to reset their rate-limit quota.
 */
function getRateLimitKey(req, prefix) {
    const identifier = req.user?.id || ipKeyGenerator(req.ip || '127.0.0.1');
    // Store rateLimitKey on request for logging purposes
    req.rateLimitKey = identifier;
    return `gf:limiter:${prefix}:${identifier}`;
}

/**
 * Standard 429 response handler.
 */
const limitReachedHandler = (req, res, next, options) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfter = resetTime ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000)) : 60;
    
    console.warn(`[\x1b[31mRATE LIMIT EXCEEDED\x1b[0m] Path: ${req.originalUrl || req.url} | ID: ${shortId(req.rateLimitKey)} | Retry-After: ${retryAfter}s`);
    
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
        success: false,
        error: { message: `Please wait ${retryAfter} seconds before trying again. Your text has not been changed.`, code: 'PLEASE_WAIT' },
        retryAfter: retryAfter
    });
};

// 1. AI Limiter: 15 req/min
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    store: new SlidingWindowStore(60 * 1000),
    keyGenerator: (req) => getRateLimitKey(req, 'ai'),
    handler: limitReachedHandler
});

// 2. Doc Limiter: 5 req/min
const docLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new SlidingWindowStore(60 * 1000),
    keyGenerator: (req) => getRateLimitKey(req, 'doc'),
    handler: limitReachedHandler
});

// 3. Read Limiter: 30 req/min
const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: new SlidingWindowStore(60 * 1000),
    keyGenerator: (req) => getRateLimitKey(req, 'read'),
    handler: limitReachedHandler
});

// Routes that have their own limiter, so the global one must not count them twice.
const SELF_LIMITED = ['/rewrite', '/grammar-fix', '/suggestions', '/autocomplete', '/analyze-realtime', '/analyze-smart',
    '/process-document', '/history', '/job', '/dev-editor/assist', '/dev-editor/execute', '/feedback'];
// Probes that must never be throttled. Match the exact path only: a query string such as "?x=/health" is not part of it.
const UNLIMITED = ['/api/v1/health'];
function skipGlobalLimit(req) {
    const path = (req.baseUrl || '') + (req.path || '');
    if (UNLIMITED.includes(path)) return true;
    return SELF_LIMITED.some(route => path === '/api/v1' + route || path.startsWith('/api/v1' + route + '/'));
}

// 4. Global Safety Limiter: 100 req/min (protects all other endpoints)
const globalSafetyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new SlidingWindowStore(60 * 1000),
    keyGenerator: (req) => getRateLimitKey(req, 'global'),
    skip: skipGlobalLimit,
    handler: limitReachedHandler
});

module.exports = {
    skipGlobalLimit,
    // five messages in ten minutes: plenty for a person, useless for flooding the database
    feedbackLimiter: rateLimit({
        windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
        store: new SlidingWindowStore(10 * 60 * 1000), keyGenerator: req => getRateLimitKey(req, 'feedback'), handler: limitReachedHandler
    }),
    executionLimiter: rateLimit({
        windowMs:60000,limit:10,standardHeaders:true,legacyHeaders:false,
        store:new SlidingWindowStore(60000),keyGenerator:req=>getRateLimitKey(req,'execution'),handler:limitReachedHandler
    }),
    authLimiter: rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        store: new SlidingWindowStore(15 * 60 * 1000),
        keyGenerator: req => `gf:limiter:auth:${ipKeyGenerator(req.ip || '127.0.0.1')}`,
        handler: limitReachedHandler
    }),
    // Dictation sends one short clip per spoken phrase, so it needs more headroom than a typed request.
    dictationLimiter: rateLimit({
        windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
        store: new SlidingWindowStore(60 * 1000), keyGenerator: req => getRateLimitKey(req, 'dictation'), handler: limitReachedHandler
    }),
    aiLimiter,
    docLimiter,
    readLimiter,
    globalSafetyLimiter
};
