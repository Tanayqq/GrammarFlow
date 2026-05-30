const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL_NAME = "llama-3.3-70b-versatile";

// Initialize Upstash Redis client
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log("[REDIS] Client initialized successfully.");
} else {
    console.warn("[REDIS WARNING] UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN are not set. Caching will be bypassed.");
}

/**
 * Generates a SHA-256 hash key for Redis from the systemPrompt and userText.
 */
function generateCacheKey(systemPrompt, userText) {
    const combined = `${systemPrompt}:${userText}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return `gf:cache:${hash}`;
}

async function callGroqAPI(systemPrompt, userText, temperature = 0.7) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY is not configured on the server.");
    }

    // 1. Check Redis Cache first (if client is configured)
    let cacheKey = "";
    if (redis) {
        try {
            cacheKey = generateCacheKey(systemPrompt, userText);
            const cachedResult = await redis.get(cacheKey);
            if (cachedResult) {
                console.log(`[\x1b[32mCACHE HIT\x1b[0m] Key: ${cacheKey}`);
                return { text: cachedResult, source: "cache" };
            }
            console.log(`[\x1b[33mCACHE MISS\x1b[0m] Key: ${cacheKey}`);
        } catch (cacheError) {
            console.error("[REDIS ERROR] Failed to fetch from cache:", cacheError.message);
        }
    }

    // 2. Call Groq API on Cache Miss
    let attempts = 0;
    const maxRetries = 3;
    const timeoutMs = 90000; // 90 seconds

    while (attempts < maxRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            console.log(`[AI SERVICE] Calling Groq API (Attempt ${attempts + 1})...`);
            
            const response = await fetch(GROQ_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userText }
                    ],
                    temperature: temperature
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const errorMsg = errorBody.error?.message || `Groq API Error: ${response.status}`;
                console.error(`[\x1b[31mAI ERROR\x1b[0m] Status: ${response.status} - ${errorMsg}`);
                
                if (response.status === 401) throw new Error("Invalid API Key");
                if (response.status === 429) throw new Error("Groq API rate limit exceeded");
                
                throw new Error(errorMsg);
            }

            const data = await response.json();
            if (!data.choices || !data.choices[0]) {
                throw new Error("Invalid response format from Groq API");
            }
            
            const resultText = data.choices[0].message.content.trim();

            // 3. Store the result in Redis with a 24-hour TTL (86,400 seconds)
            if (redis && cacheKey) {
                try {
                    await redis.set(cacheKey, resultText, { ex: 86400 });
                    console.log(`[REDIS] Cached result stored for key: ${cacheKey} (TTL: 24h)`);
                } catch (cacheStoreError) {
                    console.error("[REDIS ERROR] Failed to store in cache:", cacheStoreError.message);
                }
            }

            return { text: resultText, source: "openai" };

        } catch (error) {
            clearTimeout(timeoutId);
            attempts++;
            
            const isTimeout = error.name === 'AbortError';
            const errorMessage = isTimeout ? "Request timed out after 90s" : error.message;
            
            console.error(`[AI SERVICE] Attempt ${attempts} failed: ${errorMessage}`);
            
            if (attempts >= maxRetries) {
                throw new Error(isTimeout 
                    ? "Connection to AI timed out. Please try again." 
                    : `Connection to AI failed: ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)));
        }
    }
}

module.exports = {
    callGroqAPI
};
