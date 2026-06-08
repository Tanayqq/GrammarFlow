const { redisConnection } = require('../queue');
const { generateCacheKey } = require('../utils/cacheKey');
const prompts = require('../config/prompts');
const { detectLanguage } = require('../utils/language');

/**
 * Pre-rate-limiter cache pre-check middleware.
 * If there's a cache hit in Redis, it sets req.isCacheHit = true and req.cachedResponse
 * so that the rate limiter bypasses quota consumption and the controller serves it instantly.
 */
async function aiCacheCheck(req, res, next) {
    // Check if we have a valid request body and text/context
    if (!req.body) {
        return next();
    }

    const path = req.path;
    let prompt = null;
    let userText = null;

    try {
        if (path === '/rewrite') {
            const { text, style = "Casual", tone = "Friendly", language = "English", humanize = false } = req.body;
            if (text) {
                prompt = prompts.getRewritePrompt(style, tone, language, humanize);
                userText = text;
            }
        } else if (path === '/grammar-fix') {
            const { text, language = "English", humanize = false, _extensionPrompt } = req.body;
            if (text) {
                prompt = _extensionPrompt || prompts.getGrammarFixPrompt(language, humanize);
                userText = text;
            }
        } else if (path === '/suggestions') {
            const { text, language = "English" } = req.body;
            if (text) {
                prompt = prompts.getSuggestionsPrompt(language);
                userText = text;
            }
        } else if (path === '/autocomplete') {
            const { context, partial_word, language = "English" } = req.body;
            if (context) {
                prompt = prompts.getAutocompletePrompt(context, language);
                userText = partial_word || "";
            }
        } else if (path === '/analyze-realtime') {
            let { text, language = "English", humanize = false } = req.body;
            if (text && text.trim().length >= 3) {
                if (language === "Auto" || language === "Auto-Detect") {
                    language = detectLanguage(text);
                }
                prompt = prompts.getStableRealtimePrompt(language, humanize);
                userText = text;
            }
        } else if (path === '/analyze-smart') {
            let { text, language = "English", humanize = false, writingContext = {} } = req.body;
            if (text && text.trim().length >= 10) {
                if (language === "Auto" || language === "Auto-Detect") {
                    language = detectLanguage(text);
                }
                prompt = prompts.getSmartSuggestionsPrompt(language, humanize, writingContext);
                userText = text;
            }
        } else if (path === '/process-document') {
            const { text, mode = "Summarize", language = "English", style = "Casual", tone = "Friendly", humanize = false, isConsolidation = false } = req.body;
            if (text && text.trim().length > 0) {
                prompt = prompts.getDocumentProcessingPrompt(mode, language, style, tone, humanize, isConsolidation);
                userText = text;
            }
        }

        // If we successfully derived prompt and userText, check the Redis cache
        if (prompt && userText !== null) {
            const cacheKey = generateCacheKey(prompt, userText);
            
            // Query Redis using the existing redisConnection (ioredis client)
            if (redisConnection && redisConnection.status === 'ready') {
                const cachedValue = await redisConnection.get(cacheKey);
                if (cachedValue) {
                    console.log(`[\x1b[32mCACHE HIT PRE-CHECK\x1b[0m] Bypassing limiter for Key: ${cacheKey}`);
                    req.isCacheHit = true;
                    req.cachedResponse = cachedValue;
                } else {
                    console.log(`[\x1b[33mCACHE MISS PRE-CHECK\x1b[0m] Key: ${cacheKey}`);
                }
            }
        }
    } catch (err) {
        console.error("[CACHE PRE-CHECK ERROR] Failed to perform cache check:", err.message);
        // Resilient fallback: call next() to let request proceed through rate limiting & normal path
    }

    next();
}

module.exports = {
    aiCacheCheck
};
