// The standalone local Dev Editor has no background queues or shared Redis.
const redisConnection = process.env.GRAMMARFLOW_LOCAL_DEMO === 'true' ? null : require('../queue').redisConnection;
const { generateCacheKey } = require('../utils/cacheKey');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
const cache = new Map();
const pending = new Map();
const cooldowns = new Map();
let cacheDisabledUntil = 0;
let providerDisabledUntil = 0;

function unavailable(retryAfter = 30) {
    const error = new Error('Writing assistance is temporarily busy. Your text has not been changed. Please try again shortly.');
    error.code = 'AI_TEMPORARILY_UNAVAILABLE';
    error.status = 503;
    error.retryAfter = Math.max(1, Math.ceil(retryAfter));
    return error;
}

async function generate(systemPrompt, userText, temperature, opts, key) {
    // Keys belonging to the same organization share limits. Rotating them does not add capacity.
    const apiKey = (process.env.GROQ_API_KEY || '').split(',')[0].trim();
    if (!apiKey || Date.now() < providerDisabledUntil) throw unavailable();
    if (redisConnection?.status === 'ready' && Date.now() >= cacheDisabledUntil) {
        try {
            const value = await redisConnection.get(key);
            if (typeof value === 'string' && value && (!opts.validate || opts.validate(value))) return { text: value, source: 'cache' };
        } catch {
            cacheDisabledUntil = Date.now() + 60000;
        }
    }
    const deadline = Date.now() + (Number.isFinite(opts.timeoutMs) ? Math.max(1000, Math.min(35000, opts.timeoutMs)) : 35000);
    const models = [...new Set([opts.model, ...MODELS].filter(Boolean))];
    let retryAfter = 30;
    for (const model of models) {
        if (Date.now() >= deadline) break;
        const cooldown = cooldowns.get(model) || 0;
        if (cooldown > Date.now()) {
            retryAfter = Math.max(retryAfter, (cooldown - Date.now()) / 1000);
            continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(12000, deadline - Date.now()));
        try {
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
                    temperature,
                    ...(Number.isInteger(opts.maxTokens) && opts.maxTokens >= 128 && opts.maxTokens <= 4096 && { max_completion_tokens: opts.maxTokens }),
                    ...(['low','medium','high'].includes(opts.reasoningEffort)&&MODELS.includes(model)&&{reasoning_effort:opts.reasoningEffort}),
                    ...(opts.responseFormat === 'json' && { response_format: { type: 'json_object' } })
                }),
                signal: controller.signal
            });
            if (!response.ok) {
                // Never forward or log provider bodies: they can contain credentials or submitted text.
                await response.body?.cancel();
                console.warn(`[AI SERVICE] Provider returned HTTP ${response.status}`);
                if (response.status === 401 || response.status === 403) {
                    providerDisabledUntil = Date.now() + 60000;
                    break;
                }
                if (response.status === 429) {
                    const header = response.headers.get('retry-after');
                    const seconds = Number(header) || (Date.parse(header) - Date.now()) / 1000;
                    retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
                    cooldowns.set(model, Date.now() + retryAfter * 1000);
                } else if (response.status >= 500) {
                    cooldowns.set(model, Date.now() + 5000);
                } else {
                    if (response.status !== 404) break;
                    cooldowns.set(model, Date.now() + 60000);
                }
                continue;
            }
            // Keep the timeout active while consuming the response body, too.
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (typeof text !== 'string' || !text.trim() || data.choices[0].finish_reason === 'length') continue;
            const result = { text: text.trim(), source: 'groq' };
            if (result.text.length <= 100000 && (!opts.validate || opts.validate(result.text))) {
                // ponytail: process-local cache/concurrency; use shared coordination before adding replicas.
                for (const [oldKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(oldKey);
                if (cache.size >= 100) cache.delete(cache.keys().next().value);
                cache.set(key, { text: result.text, expires: Date.now() + 300000 });
                if (redisConnection?.status === 'ready' && Date.now() >= cacheDisabledUntil) {
                    redisConnection.set(key, result.text, 'EX', 300).catch(() => { cacheDisabledUntil = Date.now() + 60000; });
                }
            }
            return result;
        } catch {
            console.warn('[AI SERVICE] Provider request failed or timed out.');
        } finally {
            clearTimeout(timeout);
        }
    }
    throw unavailable(retryAfter);
}

async function callGroqAPI(systemPrompt, userText, temperature = 0.7, options = {}) {
    const opts = typeof options === 'string' ? { model: options } : (options || {});
    const key = generateCacheKey(JSON.stringify([systemPrompt, temperature, opts.model || '', opts.responseFormat || '', opts.maxTokens || '',opts.reasoningEffort||'']), userText);
    const cached = cache.get(key);
    if (cached?.expires > Date.now() && (!opts.validate || opts.validate(cached.text))) return { text: cached.text, source: 'cache' };
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    // Bound concurrent work, including optional cache reads, during bursts or provider outages.
    if (pending.size >= 4) throw unavailable(10);
    const request = generate(systemPrompt, userText, temperature, opts, key);
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
}

module.exports = { callGroqAPI };
