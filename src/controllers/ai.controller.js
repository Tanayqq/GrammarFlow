const aiService = require('../services/ai.service');
const prompts = require('../config/prompts');
const { aiQueue } = require('../queue');
const { aiHistoryQueue } = require('../historyQueue');
const prisma = require('../db');

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
// Shared language auto-detection
// Handles Unicode script + romanized keywords for
// Telugu-English, Kannada-English, and Hinglish mixes
// ─────────────────────────────────────────────
const TELUGU_WORDS = [
    // Verbs / states
    "undi", "unte", "ledu", "ledhu", "aina", "aindi", "ayindi", "achindi", "ayyindi",
    "vellipoyanu", "vastundi", "pothundi", "padutundi", "chesthunnanu", "antunnaru",
    "cheyyadam", "cheppali", "chudandi", "matladham", "maatladham", "chestha",
    // Pronouns / connectors
    "naaku", "nenu", "meeru", "memu", "mana", "vaadu", "aame", "vaallaki",
    "ikkade", "akkade", "eppudu", "enduku", "ento", "emito", "naku",
    // Adjectives / adverbs
    "chaala", "konchem", "manchidi", "manchi", "kastam", "kastanga",
    "tarvata", "mundu", "ippudu", "inkaa", "mari", "ayitey",
    // Fillers / casual
    "anna", "akka", "anduke", "ante", "ra", "raa"
];

const KANNADA_WORDS = [
    // Verbs / states
    "baralla", "hogalla", "madalla", "ide", "adhu", "hodha", "bandha", "madidha",
    "aagilla", "aagitta", "maadona", "matnadona", "hogona", "barona",
    "bekittu", "bedalla", "aaguttide", "maaduttide", "maadtini", "barteeni",
    // Pronouns / connectors
    "nanu", "neenu", "avru", "avnu", "avlu", "naavu", "nimma", "namma",
    "alli", "illi", "yelli", "yaavaga", "yaake", "enu", "hege",
    // Adjectives / adverbs
    "swalpa", "tumba", "chennagide", "chennagi", "kashta", "kashtada",
    "ivattu", "mele", "kelage", "munche", "naale",
    // Fillers / casual
    "kano", "kanri", "bega", "idiya", "hange", "ri", "ree"
];

const HINGLISH_WORDS = [
    "hai", "hain", "hoon", "tha", "thi", "kya", "toh",
    "yaar", "bhai", "acha", "accha", "nahi", "nahin",
    "mein", "kar", "hota", "hoti", "hote", "karo", "karna",
    "aur", "lekin", "phir", "abhi", "kal", "aaj",
    "matlab", "bilkul", "zaroor", "theek", "arre", "yeh", "woh"
];

const detectLanguage = (text) => {
    // 1. Unicode script detection (highest confidence)
    if (/[\u0900-\u097F]/.test(text)) return 'Hindi';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'Telugu';
    if (/[\u0C80-\u0CFF]/.test(text)) return 'Kannada';

    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const count = (list) => words.filter(w => list.includes(w)).length;

    const teluguScore = count(TELUGU_WORDS);
    const kannadaScore = count(KANNADA_WORDS);
    const hinglishScore = count(HINGLISH_WORDS);

    const maxScore = Math.max(teluguScore, kannadaScore, hinglishScore);
    if (maxScore < 1) return 'English';

    if (teluguScore === maxScore && teluguScore >= 1) return 'Telugu-English';
    if (kannadaScore === maxScore && kannadaScore >= 1) return 'Kannada-English';
    if (hinglishScore >= 1) return 'Hinglish';

    return 'English';
};

// ─────────────────────────────────────────────
// Standard endpoints
// ─────────────────────────────────────────────
const rewrite = async (req, res, next) => {
    const startTime = Date.now();
    try {
        const { text, style = "Casual", tone = "Friendly", language = "English", humanize = false } = req.body;
        const guestSessionId = req.headers['x-guest-session-id'] || null;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required", code: "MISSING_INPUT" } });

        console.log(`[API v1] /rewrite. Lang: ${language}, Humanize: ${humanize}`);

        let resultText = "";
        let source = "groq";
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
        if (guestSessionId) {
            aiHistoryQueue.add('save-history', {
                guest_session_id:   guestSessionId,
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
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        
        const prompt = _extensionPrompt || prompts.getGrammarFixPrompt(language, humanize);
        
        console.log(`[API v1] Queueing grammarFix job...`);
        const job = await aiQueue.add('grammar-fix', {
            prompt,
            text,
            temperature:    0.2,
            guest_session_id: guestSessionId,
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
        const prompt = prompts.getSuggestionsPrompt(language);
        const response = await aiService.callGroqAPI(prompt, text, 0.5);
        let parsedSuggestions = [];
        try {
            const jsonMatch = response.text.match(/\[.*\]/s);
            parsedSuggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [response.text];
        } catch (e) { parsedSuggestions = [response.text]; }
        sendResponse(res, true, parsedSuggestions, null, { language, source: response.source });
    } catch (error) {
        res.status(500).json({ success: false, error: { message: "Failed to get suggestions" } });
    }
};

const autocomplete = async (req, res, next) => {
    try {
        const { context, partial_word, language = "English" } = req.body;
        if (!context) return res.status(400).json({ success: false, error: { message: "Context is required" } });
        const prompt = prompts.getAutocompletePrompt(context, language);
        const response = await aiService.callGroqAPI(prompt, partial_word || "", 0.3);
        sendResponse(res, true, response.text.replace(/^[\"']|[\"']$/g, '').trim(), null, { language, source: response.source });
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

        const prompt = prompts.getStableRealtimePrompt(language, humanize);
        const response = await aiService.callGroqAPI(prompt, text, 0.55);

        let suggestionsList = [];
        try {
            const jsonMatch = response.text.match(/\[[\s\S]*\]/);
            suggestionsList = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) { suggestionsList = []; }

        sendResponse(res, true, suggestionsList, null, { language, humanize, source: response.source });
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

        const prompt = prompts.getSmartSuggestionsPrompt(language, humanize, writingContext);
        const response = await aiService.callGroqAPI(prompt, text, 0.45);

        let raw = [];
        try {
            const jsonMatch = response.text.match(/\[[\s\S]*\]/);
            raw = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) {
            console.error("[Smart] Parse error:", response.text.substring(0, 200));
            raw = [];
        }

        const ranked = rankSuggestions(raw, writingContext);
        console.log(`[Smart] Ranked ${ranked.length} suggestions (from ${raw.length} raw)`);

        sendResponse(res, true, ranked, null, { language, humanize, intent: writingContext.intent, mode: 'smart', source: response.source });
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
        const model = "llama-3.1-8b-instant";
        const response = await aiService.callGroqAPI(prompt, text, 0.4, model);
        // The result is just raw markdown text, we wrap it in an array to match the frontend expectations
        sendResponse(res, true, [response.text.trim()], null, { mode, language, humanize, source: response.source });
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
        if (!guestSessionId) {
            return res.status(400).json({ success: false, error: { message: 'x-guest-session-id header is required' } });
        }

        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const skip  = (page - 1) * limit;

        const user = await prisma.user.findUnique({ where: { guest_session_id: guestSessionId } });
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
        if (!guestSessionId) {
            return res.status(400).json({ success: false, error: { message: 'x-guest-session-id header is required' } });
        }

        const operation = await prisma.aiOperation.findUnique({
            where: { id: req.params.id },
            include: { user: { select: { guest_session_id: true } } }
        });

        if (!operation) {
            return res.status(404).json({ success: false, error: { message: 'Operation not found' } });
        }

        // Security: only return operation if it belongs to this guest session
        if (operation.user.guest_session_id !== guestSessionId) {
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
