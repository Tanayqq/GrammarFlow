const aiService = require('../services/ai.service');
const dictation = require('../services/dictation');
const prompts = require('../config/prompts');
const { aiQueue, redisConnection } = require('../queue');
const { aiHistoryQueue } = require('../historyQueue');
const { logHistoryRecord } = require('../historyWorker');
const prisma = require('../db');
const { detectLanguage, draftLanguage } = require('../utils/language');
const { sendAIError } = require('../utils/publicError');
const { isRomanHinglish } = require('../utils/documentLanguage');

let isRedisQueueDisabled = false;

// Helper for standardized API responses
const sendResponse = (res, success, data = null, error = null, metadata = {}) => {
    res.json({
        success,
        data,
        error: error ? { message: error.message || error, code: error.code || (success ? null : 'INTERNAL_ERROR') } : null,
        metadata: { timestamp: new Date().toISOString(), version: 'v1', ...metadata }
    });
};

// ─────────────────────────────────────────────
// Standard endpoints
// ─────────────────────────────────────────────
const rewrite = async (req, res, next) => {
    const startTime = Date.now();
    try {
        const { text, style = "Casual", tone = "Friendly", humanize = false } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        const userId = req.userId || null;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required", code: "MISSING_INPUT" } });
        const language = draftLanguage(text, req.body.language || "English"); // follow the draft, not the menu

        console.log(`[API v1] /rewrite. Lang: ${language}, Humanize: ${humanize}`);

        const words = text.split(/\s+/).filter(Boolean).length;
        const sentences = text.split(/[.!?।]+/).map(s => s.trim()).filter(s => s.length > 2);
        const isLongText = words > 400 || sentences.length > 30;

        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            let attempts = 0;
            while (attempts < 2) {
                let prompt = prompts.getRewritePrompt(style, tone, language, humanize, isLongText, req.body.voiceSample);
                if (attempts > 0 && !isLongText) {
                    prompt = `CRITICAL: Previous response was invalid. Provide exactly 3 rewrites separated by ===REWRITE_SEPARATOR=== in ${language} now.\n\n${prompt}`;
                }
                try {
                    const response = await aiService.callGroqAPI(prompt, text, 0.7, { responseFormat: 'json' });
                    try {
                        const parsed = JSON.parse(response.text);
                        resultText = parsed?.result?.corrected_text || parsed?.corrected_text || response.text;
                    } catch(e) {
                        resultText = response.text;
                    }
                    source = response.source;
                    if (resultText.trim().length > 0 && !resultText.toLowerCase().includes("sorry")) break;
                } catch (err) {
                    throw err; // The service already handles transient failures; don't multiply retries.
                }
                attempts++;
            }
        }

        resultText = resultText.replace(/^(STRICT COMMAND|IMPORTANT|CRITICAL|STRICT|Note):.*?\n/gsi, '').trim();
        resultText = resultText.replace(/###\s*[0-9]?\s*Rewrite.*/gi, '');
        resultText = resultText.replace(/###.*/g, '');
        resultText = resultText.replace(/Rewrite\s*[0-9]?:?/gi, '');

        let rewrites = [];
        if (isLongText) {
            rewrites = [resultText.trim()];
        } else {
            const parts = resultText.split(/===REWRITE_SEPARATOR===|===_SEPARATOR===/);
            if (parts.length > 1) {
                rewrites = parts.map(p => {
                    return p.replace(/###.*/g, '')
                        .replace(/Rewrite\s*[0-9]?:?/gi, '')
                        .trim();
                }).filter(p => p);
            } else {
                // Fallback to splitting by numbered lines if separator failed
                const fallbackParts = resultText.split(/^[1-9][.\)]\s+/m);
                if (fallbackParts.length > 1) {
                    rewrites = fallbackParts.slice(1).map(p => p.trim()).filter(p => p);
                } else {
                    rewrites = [resultText.trim()];
                }
            }
        }

        const processingTime = Date.now() - startTime;
        sendResponse(res, true, rewrites.slice(0, 3), null, { language, humanize, source });

        // Queue history logging asynchronously — never blocks response
        if (guestSessionId || userId) {
            const historyPayload = {
                guest_session_id:   guestSessionId,
                user_id:            userId,
                input_text:         text,
                output_text:        rewrites.slice(0, 3).join('\n---\n'),
                operation_type:     'rewrite',
                language,
                style,
                model:              'openai/gpt-oss-120b',
                cached:             source === 'cache',
                status:             'success',
                processing_time_ms: processingTime,
                operation_metadata: { tone, humanize }
            };
            aiHistoryQueue.add('save-history', historyPayload).catch(err => {
                logHistoryRecord(historyPayload).catch(() => {});
            });
        }
    } catch (error) {
        console.error("[API v1] Rewrite error:", error.message);
        sendAIError(res, error);
    }
};

const grammarFix = async (req, res, next) => {
    try {
        const { text, style = "Standard", tone = "Neutral", humanize = false, learningMode = false } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        const userId = req.userId || null;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        const language = draftLanguage(text, req.body.language || "English");
        req.body.language = language; // the prompt below reads it from the body

        // The system prompt is always chosen server-side; clients may only pick an extension action.
        const prompt = prompts.getGrammarFixRoutePrompt(req.body);
        // Summary/explain prompts ask for plain text; JSON mode is only for the grammar contract.
        const responseFormat = ['summarize', 'explain'].includes(req.body.extensionAction) ? undefined : 'json';
        
        // Try background queue only if Redis is healthy and not limit-exceeded
        if (aiQueue && !isRedisQueueDisabled && redisConnection && redisConnection.status === 'ready') {
            try {
                console.log(`[API v1] Queueing grammarFix job...`);
                const job = await aiQueue.add('grammar-fix', {
                    prompt,
                    text,
                    temperature:    0.2,
                    responseFormat,
                    guest_session_id: guestSessionId,
                    user_id:        userId,
                    operation_type: 'grammar_fix',
                    language,
                    style,
                    tone
                });
                
                console.log(`[API v1] grammarFix job queued. Job ID: ${job.id}`);
                return sendResponse(res, true, { status: "queued", jobId: job.id }, null, { language, humanize });
            } catch (queueError) {
                if (queueError.message && queueError.message.includes('max requests limit exceeded')) {
                    isRedisQueueDisabled = true;
                    console.warn('[API v1] Upstash limit exceeded. Switched grammarFix to direct execution.');
                } else {
                    console.warn('[API v1] Queue unavailable. Falling back to direct execution:', queueError.message);
                }
            }
        }

        // Direct synchronous processing fallback (bypasses Redis when limits are hit or offline)
        console.log(`[API v1] Executing grammarFix directly...`);
        const startTime = Date.now();
        const response = await aiService.callGroqAPI(prompt, text, 0.2, { responseFormat });

        let finalOutputText = response.text;
        let operationIntent = null;
        let operationMetadata = { temperature: 0.2 };

        if (responseFormat === 'json') try {
            const parsed = JSON.parse(response.text);
            finalOutputText = parsed?.result?.corrected_text || response.text;
            operationIntent = parsed?.result?.intent || null;
            if (parsed.metadata) {
                operationMetadata = { ...operationMetadata, ...parsed.metadata };
            }
        } catch (e) {
            console.error('[API v1] Failed to parse JSON in direct grammarFix:', e.message);
        }

        const processingTime = Date.now() - startTime;

        if (guestSessionId || userId) {
            const historyData = {
                guest_session_id:   guestSessionId || 'unknown',
                user_id:            userId || null,
                input_text:         text,
                output_text:        finalOutputText,
                operation_type:     'grammar_fix',
                intent:             operationIntent,
                language:           language || 'English',
                style:              style || null,
                model:              'openai/gpt-oss-120b',
                cached:             response.source === 'cache',
                status:             'success',
                processing_time_ms: processingTime,
                operation_metadata: operationMetadata
            };

            aiHistoryQueue.add('save-history', historyData).catch(() => {
                logHistoryRecord(historyData).catch(() => {});
            });
        }

        return sendResponse(res, true, [finalOutputText], null, { language, humanize, source: response.source });
    } catch (error) {
        console.error("[API v1] grammarFix error:", error.message);
        sendAIError(res, error);
    }
};

const suggestions = async (req, res, next) => {
    try {
        const { text, language = "English" } = req.body;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            const prompt = prompts.getSuggestionsPrompt(language);
            const response = await aiService.callGroqAPI(prompt, text, 0.5);
            resultText = response.text;
            source = response.source;
        }
        let parsedSuggestions = [];
        try {
            const jsonMatch = resultText.match(/\[.*\]/s);
            parsedSuggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [resultText];
        } catch (e) { parsedSuggestions = [resultText]; }
        sendResponse(res, true, parsedSuggestions, null, { language, source });
    } catch (error) {
        sendAIError(res, error);
    }
};

const autocomplete = async (req, res, next) => {
    try {
        const { context, partial_word, language = "English" } = req.body;
        if (!context) return res.status(400).json({ success: false, error: { message: "Context is required" } });
        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            const prompt = prompts.getAutocompletePrompt(context, language);
            const response = await aiService.callGroqAPI(prompt, partial_word || "", 0.3);
            resultText = response.text;
            source = response.source;
        }
        sendResponse(res, true, resultText.replace(/^[\"']|[\"']$/g, '').trim(), null, { language, source });
    } catch (error) {
        sendAIError(res, error);
    }
};

// ─────────────────────────────────────────────
// Phase 3: Sentence-level realtime
// ─────────────────────────────────────────────
const analyzeRealtime = async (req, res, next) => {
    try {
        let { text, language = "English", humanize = false } = req.body;
        if (!text || text.trim().length < 3) return sendResponse(res, true, []);

        if (language === "Auto" || language === "Auto-Detect") {
            language = detectLanguage(text);
            console.log(`[Realtime] Auto-detected: ${language}`);
        }

        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            const prompt = prompts.getStableRealtimePrompt(language, humanize);
            const response = await aiService.callGroqAPI(prompt, text, 0.55);
            resultText = response.text;
            source = response.source;
        }

        let suggestionsList = [];
        try {
            const jsonMatch = resultText.match(/\[[\s\S]*\]/);
            suggestionsList = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) { suggestionsList = []; }

        sendResponse(res, true, suggestionsList, null, { language, humanize, source });
    } catch (error) {
        console.error("[Realtime] Error:", error.message);
        sendAIError(res, error);
    }
};

// ─────────────────────────────────────────────
// Phase 4: Smart Suggestions Engine
// ─────────────────────────────────────────────

const INTENT_PRIORITY = {
    professional: { Grammar: 5, Clarity: 5, Flow: 4, Transition: 3, Tone: 2, Authenticity: 1 },
    casual: { Authenticity: 5, Tone: 4, Flow: 4, Clarity: 3, Grammar: 2, Transition: 2 },
    emotional: { Tone: 5, Authenticity: 5, Flow: 3, Clarity: 2, Transition: 2, Grammar: 1 },
    neutral: { Clarity: 4, Flow: 4, Grammar: 3, Tone: 3, Authenticity: 3, Transition: 2 }
};

const rankSuggestions = (suggestions, writingContext = {}) => {
    const intent = writingContext.intent || 'neutral';
    const priorityMap = INTENT_PRIORITY[intent] || INTENT_PRIORITY.neutral;

    return suggestions
        .filter(s => (s.confidence || 0.5) >= 0.15)
        .sort((a, b) => {
            const aiDiff = (b.priority || 3) - (a.priority || 3);
            if (aiDiff !== 0) return aiDiff;
            const intentDiff = (priorityMap[b.category] || 3) - (priorityMap[a.category] || 3);
            if (intentDiff !== 0) return intentDiff;
            return (b.confidence || 0.5) - (a.confidence || 0.5);
        })
        .slice(0, 5);
};

const analyzeSmartSuggestions = async (req, res, next) => {
    try {
        let { text, language = "English", humanize = false, writingContext = {} } = req.body;
        if (!text || text.trim().length < 10) return sendResponse(res, true, []);

        if (language === "Auto" || language === "Auto-Detect") {
            language = detectLanguage(text);
            console.log(`[Smart] Auto-detected: ${language}`);
        }

        console.log(`[Smart] Analyzing. Lang: ${language}, Intent: ${writingContext.intent || '?'}, Words: ${writingContext.wordCount || '?'}`);

        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            const prompt = prompts.getSmartSuggestionsPrompt(language, humanize, writingContext);
            const response = await aiService.callGroqAPI(prompt, text, 0.45);
            resultText = response.text;
            source = response.source;
        }

        let raw = [];
        try {
            const jsonMatch = resultText.match(/\[[\s\S]*\]/);
            raw = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) {
            console.error("[Smart] Parse error:", resultText.substring(0, 200));
            raw = [];
        }

        const ranked = rankSuggestions(raw, writingContext);
        console.log(`[Smart] Ranked ${ranked.length} suggestions (from ${raw.length} raw)`);

        sendResponse(res, true, ranked, null, { language, humanize, intent: writingContext.intent, mode: 'smart', source });
    } catch (error) {
        console.error("[Smart] Error:", error.message);
        sendAIError(res, error);
    }
};

// ─────────────────────────────────────────────
// Phase 6: Document Processing
// ─────────────────────────────────────────────
const processDocument = async (req, res, next) => {
    const startTime = Date.now();
    try {
        const { text, mode = "Summarize", language = "English", style = "Casual", tone = "Friendly", humanize = false, isConsolidation = false } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ success: false, error: { message: "Document text is required" } });
        }

        console.log(`[API v1] /process-document. Mode: ${mode}, Lang: ${language}, Consolidation: ${isConsolidation}`);

        const prompt = prompts.getDocumentProcessingPrompt(mode, language, style, tone, humanize, isConsolidation);
        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            const model = "openai/gpt-oss-120b";
            const response = await aiService.callGroqAPI(prompt, text, mode === 'Explain' ? 0.2 : 0.4,
                mode === 'Explain' ? { model, timeoutMs: 20000, ...(language === 'Hinglish' && { validate: isRomanHinglish }) } : model);
            resultText = response.text;
            source = response.source;
        }
        if (mode === 'Explain' && language === 'Hinglish' && !isRomanHinglish(resultText)) {
            // One bounded repair; invalid cached output must pass the same check.
            const repaired = await aiService.callGroqAPI(prompt + '\nFINAL CHECK: Every explanatory paragraph must be Roman Hinglish, not English. Regenerate concisely in Hindi-English mixed sentences.', text, 0.2, { model: 'openai/gpt-oss-120b', timeoutMs: 20000, validate: isRomanHinglish });
            resultText = repaired.text;
            source = repaired.source;
            if (!isRomanHinglish(resultText)) return res.status(422).json({ success: false,
                error: { code: 'DOCUMENT_LANGUAGE_MISMATCH', message: 'The explanation did not match Hinglish. This part was not accepted. Please retry this document to continue.' } });
        }
        // The result is just raw markdown text, we wrap it in an array to match the frontend expectations
        sendResponse(res, true, [resultText.trim()], null, { mode, language, humanize, source });
    } catch (error) {
        console.error("[\x1b[31mDOC ERROR\x1b[0m]", error.message);
        sendAIError(res, error);
    }
};

const checkJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        if (!jobId) {
            return res.status(400).json({ success: false, error: { message: "Job ID is required" } });
        }

        let job;
        try {
            job = await aiQueue.getJob(jobId);
        } catch (queueErr) {
            console.error("[API v1] Failed to retrieve job from queue:", queueErr.message);
            return res.status(503).json({ success: false, error: { message: "Queue temporarily unavailable. Please retry." } });
        }
        if (!job) {
            return res.status(404).json({ success: false, error: { message: "Job not found" } });
        }
        const ownsJob = job.data?.user_id
            ? req.userId && req.userId === job.data.user_id
            : job.data?.guest_session_id && req.headers['x-guest-session-id'] === job.data.guest_session_id;
        if (!ownsJob) return res.status(404).json({ success: false, error: { message: 'Job not found' } });

        let state = 'active';
        try {
            state = await job.getState();
        } catch (stateErr) {
            console.error("[API v1] Failed to get job state:", stateErr.message);
        }
        console.log(`[API v1] Checking status for Job ID ${jobId}: ${state}`);

        if (state === 'completed') {
            const result = job.returnvalue;
            const resultText = result ? (result.text || "") : "";
            const source = result ? (result.source || "groq") : "groq";
            return sendResponse(res, true, { status: "completed", result: resultText }, null, { source });
        }

        if (state === 'failed') {
            return res.json({
                success: false,
                data: { status: "failed" },
                error: { message: "Writing assistance is temporarily busy. Your text has not been changed. Please try again shortly." }
            });
        }

        return sendResponse(res, true, { status: state });
    } catch (error) {
        console.error("[API v1] Job status check error:", error.message);
        sendAIError(res, error);
    }
};

const getHistory = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        if (!req.userId && !guestSessionId) {
            return res.status(400).json({ success: false, error: { message: 'Authentication or x-guest-session-id header is required' } });
        }

        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 10));
        const skip  = (page - 1) * limit;

        let user = null;
        try {
            if (req.userId) {
                user = await prisma.user.findUnique({ where: { id: req.userId } });
            }
            if (!user && guestSessionId) {
                user = await prisma.user.findUnique({ where: { guest_session_id: guestSessionId } });
            }
        } catch (dbError) {
            console.error('[API v1] Database lookup failed in getHistory, degrading to offline:', dbError.message);
            return sendResponse(res, true, { operations: [], total: 0, page, limit, totalPages: 0, offline: true });
        }

        if (!user) {
            return sendResponse(res, true, { operations: [], total: 0, page, limit });
        }

        // Security check: if unauthenticated request resolved a user via guest_session_id,
        // NEVER return history if that user record belongs to a registered (non-guest) account.
        // Registered accounts have an email (Clerk or mock auth) or password_hash (mock auth).
        // A pure guest account has no email and no password_hash.
        if (!req.userId && (user.email || user.password_hash)) {
            console.log(`[API v1] Blocking unauthenticated history request for registered user ID: ${user.id} (email: ${user.email ? 'yes' : 'no'}, password: ${user.password_hash ? 'yes' : 'no'})`);
            // Clear the guest_session_id link from this registered user to prevent future leaks
            // (this can happen when the new guest_session_id gets linked during a logout race condition)
            try {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { guest_session_id: null }
                });
                console.log(`[API v1] Cleared guest_session_id link from registered user ${user.id} to prevent future leaks`);
            } catch (clearErr) {
                console.warn(`[API v1] Could not clear guest_session_id from registered user:`, clearErr.message);
            }
            return sendResponse(res, true, { operations: [], total: 0, page, limit, totalPages: 0 });
        }

        try {
            const [operations, total] = await Promise.all([
                prisma.aiOperation.findMany({
                    where:   { user_id: user.id },
                    orderBy: { created_at: 'desc' },
                    skip,
                    take:    limit,
                    select: {
                        id:             true,
                        operation_type: true,
                        language:       true,
                        style:          true,
                        cached:         true,
                        status:         true,
                        created_at:     true
                    }
                }),
                prisma.aiOperation.count({ where: { user_id: user.id } })
            ]);

            sendResponse(res, true, { operations, total, page, limit, totalPages: Math.ceil(total / limit) });
        } catch (dbError) {
            console.error('[API v1] Database query failed in getHistory, degrading to offline:', dbError.message);
            return sendResponse(res, true, { operations: [], total: 0, page, limit, totalPages: 0, offline: true });
        }
    } catch (error) {
        console.error('[API v1] getHistory error:', error.message);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve history' } });
    }
};

const getHistoryDetail = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const guestSessionId = req.headers['x-guest-session-id'] || null;

        let operation = null;
        try {
            operation = await prisma.aiOperation.findUnique({
                where: { id: req.params.id },
                include: { user: { select: { guest_session_id: true, email: true, password_hash: true } } }
            });
        } catch (dbError) {
            console.error('[API v1] Database lookup failed in getHistoryDetail:', dbError.message);
            return res.status(503).json({ success: false, error: { message: 'Database connection is temporarily offline.', code: 'DATABASE_OFFLINE' } });
        }

        if (!operation) {
            return res.status(404).json({ success: false, error: { message: 'Operation not found' } });
        }

        // Security: only return operation if it belongs to this authenticated user or guest session (if guest, target user must not be registered)
        const isOwner = (req.userId && operation.user_id === req.userId) ||
                        (guestSessionId && operation.user?.guest_session_id === guestSessionId && !operation.user.email && !operation.user.password_hash);

        if (!isOwner) {
            return res.status(403).json({ success: false, error: { message: 'Access denied' } });
        }

        // The `user` relation (including password_hash) was only fetched for the ownership
        // check above; never send it to the client.
        const { user, ...safeOperation } = operation;
        sendResponse(res, true, safeOperation);
    } catch (error) {
        console.error('[API v1] getHistoryDetail error:', error.message);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve operation details' } });
    }
};

const deleteHistory = async (req, res) => {
    try {
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        const opId = req.params.id;

        // Find the operation first to verify ownership
        let operation = null;
        try {
            operation = await prisma.aiOperation.findUnique({
                where: { id: opId },
                include: { user: { select: { id: true, guest_session_id: true, email: true, password_hash: true } } }
            });
        } catch (dbError) {
            return res.status(503).json({ success: false, error: { message: 'Database unavailable', code: 'DATABASE_OFFLINE' } });
        }

        if (!operation) {
            return res.status(404).json({ success: false, error: { message: 'Operation not found' } });
        }

        // Security: only allow deletion if the operation belongs to this user/guest (if guest, target user must not be registered)
        const isOwner = (req.userId && operation.user_id === req.userId) ||
                        (guestSessionId && operation.user?.guest_session_id === guestSessionId && !operation.user.email && !operation.user.password_hash);

        if (!isOwner) {
            return res.status(403).json({ success: false, error: { message: 'Access denied' } });
        }

        await prisma.aiOperation.delete({ where: { id: opId } });
        sendResponse(res, true, { deleted: true, id: opId });
    } catch (error) {
        console.error('[API v1] deleteHistory error:', error.message);
        res.status(500).json({ success: false, error: { message: 'Failed to delete history item' } });
    }
};

// Body is raw audio (express.raw in server.js caps it at 5 MB).
const transcribe = async (req, res) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!aiService.AUDIO_TYPES[type]) return res.status(415).json({ success: false, error: { message: 'Send audio as webm, ogg, mp4, mp3 or wav.', code: 'UNSUPPORTED_AUDIO' } });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ success: false, error: { message: 'No audio was received.', code: 'MISSING_INPUT' } });
    // What is already written and the language menu choice arrive as headers, since the body is audio.
    const header = name => { try { return decodeURIComponent(String(req.headers[name] || '')).slice(0, 400); } catch { return ''; } };
    const context = header('x-dictation-context'), target = dictation.parseTarget(header('x-dictation-target'));
    try {
        const heard = await aiService.transcribeDetailed(req.body, type, dictation.hintFor({ target, context }));
        // Still labelled as a language GrammarFlow does not offer (and no hint could redo it): the transcript is a
        // guess, and converting a guess would invent sentences. Say so instead.
        if (heard.text && dictation.MISHEARD.has(heard.language)) {
            return res.status(422).json({ success: false, error: { message: 'Could not tell which language was spoken. Choose Kannada, Telugu or Hindi in the language menu and try again.', code: 'LANGUAGE_UNCLEAR' } });
        }
        let text = heard.text, converted = false;
        if (text && dictation.needsConversion({ target, context, detected: heard.language, text })) {
            const result = await aiService.convertDictation({ spoken: text, context, target });
            if (result) { text = result; converted = true; }
        }
        sendResponse(res, true, { text, spoken: heard.text, language: heard.language, converted });
    } catch (error) {
        sendAIError(res, error);
    }
};


const HUMANIZER_AI_TELLS = [
    'delve','delves','delved','delving','pivotal','tapestry','testament',
    'multifaceted','in conclusion,','furthermore,','moreover,','in summary,',
    'it is important to note','it is worth noting','it is crucial to',
    'plays a crucial role','plays a pivotal role','stands as a testament',
    'underscores','showcases','embodies','aligns with','rapidly evolving',
    'ever-evolving','robust framework','innovative approach','cutting-edge',
    'paradigm shift','seamlessly','holistic','synergize','leverage',
];

function buildHumanizePrompt(text, style, intensity, stages) {
    const styleGuide = {
        academic: 'formal academic prose, precise terminology, third-person perspective',
        conversational: 'warm conversational tone, natural speech patterns',
        casual: 'relaxed casual language, contractions, everyday vocabulary',
        technical: 'precise technical language, active voice, direct statements',
    }[style] || 'natural human prose';

    const intensityDesc = intensity >= 85 ? 'AGGRESSIVE — rewrite extensively, restructure freely'
        : intensity >= 60 ? 'MODERATE — transform clearly but preserve key phrasing'
        : 'SUBTLE — light touch, minimal structural changes';

    const stageLines = [
        stages.synonyms && '• Stage 1: SYNONYM SUBSTITUTION — Replace predictable words with less common but equivalent alternatives',
        stages.phrase_rewrite && '• Stage 2: PHRASE REWRITING — Replace formulaic AI phrases. NEVER use: ' + HUMANIZER_AI_TELLS.join(', '),
        stages.determiner_swap && '• Stage 3: DETERMINER SWAPPING — Rotate demonstratives and articles contextually',
        stages.voice_transform && '• Stage 4: VOICE TRANSFORMATION — Alternate between active and passive voice',
        stages.sentence_fusion && '• Stage 5: SENTENCE FUSION — Naturally fuse adjacent short sentences',
        stages.transition_inject && '• Stage 6: TRANSITION INJECTION — Inject varied natural discourse markers',
        stages.clause_reorder && '• Stage 7: CLAUSE REORDERING — Reorder dependent clauses for natural emphasis',
        stages.nominalization && '• Stage 8: NOMINALIZATION — Convert between verb phrases and abstract nouns',
        stages.appositive && '• Stage 9: APPOSITIVE INSERTION — Add informative parentheticals where natural',
        stages.discourse_rotate && '• Stage 10: DISCOURSE ROTATION — Vary paragraph transitions and rhetorical flow',
        stages.contraction && ('• Stage 11: CONTRACTION HANDLING — ' + (style === 'academic' ? 'Expand contractions for formal register' : 'Use natural contractions')),
        stages.ngram_audit && '• Stage 12: N-GRAM AUDIT — Disrupt surviving 5-gram AI sequences by restructuring sentences',
        stages.info_reorder && '• Stage 13: INFO REORDERING — Reorder information within sentences for human authenticity',
        stages.split_compound && '• Stage 14: COMPOUND SPLITTING — Split overly complex compound sentences naturally',
        stages.ai_tell_scrubber && '• Stage 15: AI-TELL SCRUBBER — Remove ALL AI markers listed above and replace every instance',
    ].filter(Boolean).join('\n');

    return `You are TURNITOUT, a 15-stage deterministic linguistic humanization engine. Transform the text so it reads as authentic human writing undetectable by AI detectors (Turnitin, GPTZero, CopyLeaks, ZeroGPT).

TRANSFORMATION INTENSITY: ${intensity}% — ${intensityDesc}
TARGET REGISTER: ${styleGuide}

MANDATORY TRANSFORMATION STAGES (apply ALL):
${stageLines}

ABSOLUTE RULES:
1. NEVER use these AI-tell words/phrases: ${HUMANIZER_AI_TELLS.join(', ')}
2. Vary sentence length deliberately — mix short punchy sentences with longer ones (burstiness/rhythm)
3. Preserve ALL factual content, numerical data, citations, and technical terminology exactly
4. Output ONLY the transformed text — no explanations, no preamble, no meta-commentary
5. Do not add new facts or change the meaning — only the linguistic surface

INPUT TEXT:
${text}`;
}

const humanizeText = async (req, res, next) => {
    const startTime = Date.now();
    try {
        const {
            text,
            intensity = 70,
            style = 'academic',
            protected_terms = [],
            seed = null,
            enable_synonyms = true,
            enable_phrase_rewrite = true,
            enable_determiner_swap = true,
            enable_voice_transform = true,
            enable_sentence_fusion = true,
            enable_transition_inject = true,
            enable_clause_reorder = true,
            enable_nominalization = true,
            enable_appositive = true,
            enable_discourse_rotate = true,
            enable_contraction = false,
            enable_ngram_audit = true,
            enable_info_reorder = true,
            enable_split_compound = true,
            enable_ai_tell_scrubber = true,
            enable_citations = false,
            max_citations = 2,
            citation_format = 'IEEE [1]',
            citation_discipline = 'computer_science',
        } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Text is required', code: 'MISSING_INPUT' } });
        }

        const turnitoutUrl = process.env.TURNITOUT_API_URL;
        const turnitoutKey = process.env.TURNITOUT_API_KEY;

        // --- TURNITOUT ENTERPRISE PATH ---
        if (turnitoutUrl && turnitoutKey) {
            const payload = {
                text: text.trim(),
                intensity: parseFloat(intensity),
                style,
                protected_terms: Array.isArray(protected_terms) ? protected_terms : [],
                enable_synonyms: Boolean(enable_synonyms),
                enable_phrase_rewrite: Boolean(enable_phrase_rewrite),
                enable_determiner_swap: Boolean(enable_determiner_swap),
                enable_voice_transform: Boolean(enable_voice_transform),
                enable_sentence_fusion: Boolean(enable_sentence_fusion),
                enable_transition_inject: Boolean(enable_transition_inject),
                enable_clause_reorder: Boolean(enable_clause_reorder),
                enable_nominalization: Boolean(enable_nominalization),
                enable_appositive: Boolean(enable_appositive),
                enable_discourse_rotate: Boolean(enable_discourse_rotate),
                enable_contraction: Boolean(enable_contraction),
                enable_ngram_audit: Boolean(enable_ngram_audit),
                enable_info_reorder: Boolean(enable_info_reorder),
                enable_split_compound: Boolean(enable_split_compound),
                enable_ai_tell_scrubber: Boolean(enable_ai_tell_scrubber),
                enable_citations: Boolean(enable_citations),
                max_citations: parseInt(max_citations, 10) || 0,
                citation_format, citation_discipline,
            };
            const tRes = await fetch(`${turnitoutUrl}/v1/humanize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': turnitoutKey },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(30000),
            });
            if (!tRes.ok) {
                const errBody = await tRes.text();
                console.error('[Humanizer] Turnitout API error:', tRes.status, errBody);
                return res.status(502).json({ success: false, error: { message: `Turnitout API error: ${tRes.status}` } });
            }
            const data = await tRes.json();
            return res.json({ ...data, source: 'turnitout' });
        }

        // --- GROQ FALLBACK PATH ---
        const stages = {
            synonyms: enable_synonyms, phrase_rewrite: enable_phrase_rewrite,
            determiner_swap: enable_determiner_swap, voice_transform: enable_voice_transform,
            sentence_fusion: enable_sentence_fusion, transition_inject: enable_transition_inject,
            clause_reorder: enable_clause_reorder, nominalization: enable_nominalization,
            appositive: enable_appositive, discourse_rotate: enable_discourse_rotate,
            contraction: enable_contraction, ngram_audit: enable_ngram_audit,
            info_reorder: enable_info_reorder, split_compound: enable_split_compound,
            ai_tell_scrubber: enable_ai_tell_scrubber,
        };

        const systemPrompt = buildHumanizePrompt(text.trim(), style, parseFloat(intensity), stages);
        const groqResponse = await aiService.callGroqAPI(
            systemPrompt,
            text.trim(),
            Math.min(0.5 + (parseFloat(intensity) / 100) * 0.5, 1.0),
            {
                model: 'openai/gpt-oss-20b',
                reasoningEffort: 'low',
                timeoutMs: 25000
            }
        );
        const humanizedText = (groqResponse.text || '').trim();
        const latencyMs = Date.now() - startTime;

        const originalWords = text.trim().split(/\s+/);
        const humanizedWords = humanizedText.split(/\s+/);
        let modificationsCount = 0;
        const minLen = Math.min(originalWords.length, humanizedWords.length);
        for (let i = 0; i < minLen; i++) {
            if (originalWords[i].toLowerCase() !== humanizedWords[i].toLowerCase()) modificationsCount++;
        }
        modificationsCount += Math.abs(originalWords.length - humanizedWords.length);

        return res.json({
            success: true,
            humanized_text: humanizedText,
            words_processed: originalWords.length,
            modifications_count: modificationsCount,
            latency_ms: latencyMs,
            citation_count: 0,
            bib_text: null,
            source: 'groq',
        });
    } catch (err) {
        console.error('[HUMANIZE ERROR]', err.message);
        sendAIError(res, err);
    }
};

const humanizeFile = async (req, res, next) => {
    try {
        const turnitoutUrl = process.env.TURNITOUT_API_URL;
        const turnitoutKey = process.env.TURNITOUT_API_KEY;
        if (!turnitoutUrl || !turnitoutKey) {
            return res.status(503).json({
                success: false,
                error: { message: 'File humanization requires Turnitout Enterprise API. Set TURNITOUT_API_URL and TURNITOUT_API_KEY in .env.' },
                link: 'https://github.com/AhmadHassan-BTed/Turnitout-Humanizer/blob/main/ENTERPRISE_API.md',
            });
        }
        if (!req.file) return res.status(400).json({ success: false, error: { message: 'No file uploaded.' } });
        const { intensity = '70.0', style = 'academic', format_selection = 'Auto-Detect' } = req.body;
        const form = new FormData();
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
        form.append('intensity', intensity);
        form.append('style', style);
        form.append('format_selection', format_selection);
        const tRes = await fetch(`${turnitoutUrl}/v1/humanize/file`, {
            method: 'POST', headers: { 'X-API-Key': turnitoutKey },
            body: form, signal: AbortSignal.timeout(60000),
        });
        if (!tRes.ok) {
            const errBody = await tRes.text();
            return res.status(502).json({ success: false, error: { message: `Turnitout file API error: ${tRes.status}` }, detail: errBody });
        }
        const contentType = tRes.headers.get('content-type') || 'application/octet-stream';
        const contentDisposition = tRes.headers.get('content-disposition') || `attachment; filename="humanized_${req.file.originalname}"`;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', contentDisposition);
        ['X-Turnitout-Words-Charged','X-Turnitout-Words-Remaining','X-Turnitout-File-Fee-USD','X-Turnitout-Detected-Format'].forEach(h => {
            const v = tRes.headers.get(h); if (v) res.setHeader(h, v);
        });
        const arrayBuffer = await tRes.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        next(err);
    }
};

// ============================================================
// 2) In `module.exports = { ... }`, add humanizeText and humanizeFile:

module.exports = {
    transcribe,
    rewrite,
    grammarFix,
    suggestions,
    autocomplete,
    analyzeRealtime,
    analyzeSmartSuggestions,
    processDocument,
    checkJobStatus,
    getHistory,
    getHistoryDetail,
    deleteHistory,
    humanizeText,
    humanizeFile
};
