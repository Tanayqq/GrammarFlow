const aiService = require('../services/ai.service');
const prompts = require('../config/prompts');
const { aiQueue } = require('../queue');
const { aiHistoryQueue } = require('../historyQueue');
const prisma = require('../db');
const { detectLanguage } = require('../utils/language');

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
        const { text, style = "Casual", tone = "Friendly", language = "English", humanize = false } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        const userId = req.userId || null;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required", code: "MISSING_INPUT" } });

        console.log(`[API v1] /rewrite. Lang: ${language}, Humanize: ${humanize}`);

        let resultText = "";
        let source = "groq";
        if (req.isCacheHit && req.cachedResponse) {
            resultText = req.cachedResponse;
            source = "cache";
        } else {
            let attempts = 0;
            while (attempts < 2) {
                let prompt = prompts.getRewritePrompt(style, tone, language, humanize);
                if (attempts > 0) prompt = `CRITICAL: Previous response was invalid. Provide exactly 3 numbered rewrites in ${language} now.\n\n${prompt}`;
                try {
                    const response = await aiService.callGroqAPI(prompt, text, 0.7);
                    resultText = response.text;
                    source = response.source;
                    if (resultText.trim().length > 0 && !resultText.toLowerCase().includes("sorry")) break;
                } catch (err) {
                    if (attempts === 1) throw err;
                }
                attempts++;
            }
        }

        resultText = resultText.replace(/^(STRICT COMMAND|IMPORTANT|CRITICAL|STRICT|Note):.*?\n/gsi, '').trim();
        resultText = resultText.replace(/###\s*[0-9]?\s*Rewrite.*/gi, '');
        resultText = resultText.replace(/###.*/g, '');
        resultText = resultText.replace(/Rewrite\s*[0-9]?:?/gi, '');

        let rewrites = [];
        const parts = resultText.split(/^[1-9][.\)]\s+/m);
        if (parts.length > 1) {
            rewrites = parts.slice(1).map(p => {
                return p.replace(/###.*/g, '')
                    .replace(/Rewrite\s*[0-9]?:?/gi, '')
                    .trim();
            }).filter(p => p);
        } else {
            rewrites = [resultText.trim()];
        }

        const processingTime = Date.now() - startTime;
        sendResponse(res, true, rewrites.slice(0, 3), null, { language, humanize, source });

        // Queue history logging asynchronously — never blocks response
        if (guestSessionId || userId) {
            aiHistoryQueue.add('save-history', {
                guest_session_id:   guestSessionId,
                user_id:            userId,
                input_text:         text,
                output_text:        rewrites.slice(0, 3).join('\n---\n'),
                operation_type:     'rewrite',
                language,
                style,
                model:              'llama-3.3-70b-versatile',
                cached:             source === 'cache',
                status:             'success',
                processing_time_ms: processingTime,
                operation_metadata: { tone, humanize }
            }).catch(err => console.error('[API v1] /rewrite history queue error:', err.message));
        }
    } catch (error) {
        console.error("[API v1] Rewrite error:", error.message);
        res.status(500).json({ success: false, error: { message: error.message, code: "AI_PROCESSING_ERROR" } });
    }
};

const grammarFix = async (req, res, next) => {
    try {
        const { text, language = "English", humanize = false, _extensionPrompt } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        const userId = req.userId || null;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        
        const prompt = _extensionPrompt || prompts.getGrammarFixPrompt(language, humanize);
        
        console.log(`[API v1] Queueing grammarFix job...`);
        const job = await aiQueue.add('grammar-fix', {
            prompt,
            text,
            temperature:    0.2,
            guest_session_id: guestSessionId,
            user_id:        userId,
            operation_type: 'grammar_fix',
            language,
            style:          null
        });
        
        console.log(`[API v1] grammarFix job queued. Job ID: ${job.id}`);
        sendResponse(res, true, { status: "queued", jobId: job.id }, null, { language, humanize });
    } catch (error) {
        console.error("[API v1] grammarFix queueing error:", error.message);
        res.status(500).json({ success: false, error: { message: error.message } });
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
        res.status(500).json({ success: false, error: { message: "Failed to get suggestions" } });
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
        res.status(500).json({ success: false, error: { message: "Autocomplete failed" } });
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
        res.status(500).json({ success: false, error: { message: "Real-time analysis failed" } });
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
        res.status(500).json({ success: false, error: { message: "Smart analysis failed" } });
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
            const model = "llama-3.1-8b-instant";
            const response = await aiService.callGroqAPI(prompt, text, 0.4, model);
            resultText = response.text;
            source = response.source;
        }
        // The result is just raw markdown text, we wrap it in an array to match the frontend expectations
        sendResponse(res, true, [resultText.trim()], null, { mode, language, humanize, source });
    } catch (error) {
        console.error("[\x1b[31mDOC ERROR\x1b[0m]", error.message);
        sendResponse(res, false, null, error.message || "Failed to process document");
    }
};

const checkJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        if (!jobId) {
            return res.status(400).json({ success: false, error: { message: "Job ID is required" } });
        }

        const job = await aiQueue.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: { message: "Job not found" } });
        }

        const state = await job.getState(); // completed, failed, active, waiting, delayed
        console.log(`[API v1] Checking status for Job ID ${jobId}: ${state}`);

        if (state === 'completed') {
            const result = job.returnvalue;
            return sendResponse(res, true, { status: "completed", result: result.text }, null, { source: result.source });
        }

        if (state === 'failed') {
            return res.json({
                success: false,
                data: { status: "failed" },
                error: { message: job.failedReason || "Background job execution failed" }
            });
        }

        return sendResponse(res, true, { status: state });
    } catch (error) {
        console.error("[API v1] Job status check error:", error.message);
        res.status(500).json({ success: false, error: { message: error.message } });
    }
};

const getHistory = async (req, res) => {
    try {
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        if (!req.userId && !guestSessionId) {
            return res.status(400).json({ success: false, error: { message: 'Authentication or x-guest-session-id header is required' } });
        }

        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const skip  = (page - 1) * limit;

        let user = null;
        if (req.userId) {
            user = await prisma.user.findUnique({ where: { id: req.userId } });
        }
        if (!user && guestSessionId) {
            user = await prisma.user.findUnique({ where: { guest_session_id: guestSessionId } });
        }

        if (!user) {
            return sendResponse(res, true, { operations: [], total: 0, page, limit });
        }

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
    } catch (error) {
        console.error('[API v1] getHistory error:', error.message);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve history' } });
    }
};

const getHistoryDetail = async (req, res) => {
    try {
        const guestSessionId = req.headers['x-guest-session-id'] || null;

        const operation = await prisma.aiOperation.findUnique({
            where: { id: req.params.id },
            include: { user: { select: { guest_session_id: true } } }
        });

        if (!operation) {
            return res.status(404).json({ success: false, error: { message: 'Operation not found' } });
        }

        // Security: only return operation if it belongs to this authenticated user or guest session
        const isOwner = (req.userId && operation.user_id === req.userId) ||
                        (guestSessionId && operation.user?.guest_session_id === guestSessionId);

        if (!isOwner) {
            return res.status(403).json({ success: false, error: { message: 'Access denied' } });
        }

        sendResponse(res, true, operation);
    } catch (error) {
        console.error('[API v1] getHistoryDetail error:', error.message);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve operation details' } });
    }
};

module.exports = {
    rewrite,
    grammarFix,
    suggestions,
    autocomplete,
    analyzeRealtime,
    analyzeSmartSuggestions,
    processDocument,
    checkJobStatus,
    getHistory,
    getHistoryDetail
};
