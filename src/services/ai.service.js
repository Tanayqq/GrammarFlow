// The standalone local Dev Editor has no background queues or shared Redis.
const redisConnection = process.env.GRAMMARFLOW_LOCAL_DEMO === 'true' ? null : require('../queue').redisConnection;
const { generateCacheKey } = require('../utils/cacheKey');
const dictation = require('./dictation');

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

// Speech to text with Groq-hosted Whisper; the same GROQ_API_KEY as the writing features.
const TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

// No text prompt is given to Whisper: a prompt in one language makes it write other languages in that script
// (English speech came back as Telugu-looking gibberish when the draft was Telugu). It must hear what was said.
async function whisper(audio, mimeType, language, deadline) {
    const apiKey = (process.env.GROQ_API_KEY || '').split(',')[0].trim();
    if (!apiKey || Date.now() < providerDisabledUntil) throw unavailable();
    for (const model of WHISPER_MODELS) {
        const remaining = deadline - Date.now();
        if (remaining < 1000) break;
        const form = new FormData();
        form.append('file', new Blob([audio], { type: mimeType }), `speech.${AUDIO_TYPES[mimeType]}`);
        form.append('model', model);
        form.append('response_format', 'verbose_json'); // adds the detected language
        form.append('temperature', '0');
        if (language) form.append('language', language);
        const response = await fetch(TRANSCRIBE_URL, {
            method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(remaining)
        }).catch(() => null);
        if (response?.ok) {
            try { // the body can still fail after the headers arrive: then try the next model
                const body = await response.json();
                return { text: String(body.text || '').trim(), language: String(body.language || '').toLowerCase() };
            } catch { continue; }
        }
        await response?.body?.cancel().catch(() => {}); // free the connection
        if (response?.status === 429) throw unavailable(Number(response.headers.get('retry-after')) || 30);
        // Any other failure (e.g. a retired model): try the next model.
    }
    throw unavailable();
}

// hint: the writer's language as a Whisper code. It is used only to redo a clip that Whisper labelled as a
// language GrammarFlow does not offer (Kannada is often heard as Tamil), never to force the first pass.
async function transcribeDetailed(audio, mimeType, hint = null) {
    const deadline = Date.now() + 40000; // one budget for every attempt, well inside the browser's 55 s timeout
    const first = await whisper(audio, mimeType, null, deadline);
    if (!hint || !dictation.MISHEARD.has(first.language)) return first;
    try {
        const second = await whisper(audio, mimeType, hint, deadline);
        if (second.text) return { text: second.text, language: dictation.WHISPER_LANGUAGES[hint] };
    } catch { /* keep the first pass */ }
    return first;
}

const transcribe = async (audio, mimeType, hint) => (await transcribeDetailed(audio, mimeType, hint)).text;

// Converts dictated text into the writer's language, keeping meaning and tone. Returns null when
// the model is unavailable or its answer fails the sanity checks, so the caller keeps the raw words.
async function convertDictation({ spoken, context, target }) {
    const { system, user } = dictation.buildPrompt({ spoken, context, target });
    try {
        const result = await callGroqAPI(system, user, 0.2, {
            model: 'openai/gpt-oss-120b', // meaning is the core principle: always the strongest model
            reasoningEffort: 'low', maxTokens: 512, timeoutMs: 10000,
            validate: output => dictation.acceptable(output, spoken, context)
        });
        return dictation.acceptable(result.text, spoken, context) ? result.text.trim() : null;
    } catch {
        return null;
    }
}

module.exports = { callGroqAPI, transcribe, transcribeDetailed, convertDictation, AUDIO_TYPES };
