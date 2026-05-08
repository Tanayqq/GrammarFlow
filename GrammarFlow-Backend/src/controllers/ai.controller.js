const aiService = require('../services/ai.service');
const prompts = require('../config/prompts');

// Helper for standardized API responses
const sendResponse = (res, success, data = null, error = null, metadata = {}) => {
    res.json({
        success,
        data,
        error: error ? { message: error.message || error, code: error.code || (success ? null : 'INTERNAL_ERROR') } : null,
        metadata: { timestamp: new Date().toISOString(), version: 'v1', ...metadata }
    });
};

const rewrite = async (req, res, next) => {
    try {
        const { text, style = "Casual", tone = "Friendly", language = "English", humanize = false } = req.body;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required", code: "MISSING_INPUT" } });

        console.log(`[API v1] /rewrite. Lang: ${language}, Humanize: ${humanize}`);

        let resultText = "";
        let attempts = 0;
        while (attempts < 2) {
            let prompt = prompts.getRewritePrompt(style, tone, language, humanize);
            if (attempts > 0) prompt = `CRITICAL: Previous response was invalid. Provide exactly 3 numbered rewrites in ${language} now.\n\n${prompt}`;
            try {
                resultText = await aiService.callGroqAPI(prompt, text, 0.7);
                if (resultText.trim().length > 0 && !resultText.toLowerCase().includes("sorry")) break;
            } catch (err) {
                if (attempts === 1) throw err;
            }
            attempts++;
        }

        resultText = resultText.replace(/^(STRICT COMMAND|IMPORTANT|CRITICAL|STRICT|Note):.*?\n/gsi, '').trim();
        const lines = resultText.split('\n').map(l => l.trim()).filter(l => l);
        let rewrites = [];
        for (const line of lines) {
            const match = line.match(/^[1-3][.\)]\s*(.*)/);
            if (match) rewrites.push(match[1].trim());
        }
        if (rewrites.length === 0) rewrites = [resultText];
        sendResponse(res, true, rewrites.slice(0, 3), null, { language, humanize });
    } catch (error) {
        console.error("[API v1] Rewrite error:", error.message);
        res.status(500).json({ success: false, error: { message: error.message, code: "AI_PROCESSING_ERROR" } });
    }
};

const grammarFix = async (req, res, next) => {
    try {
        const { text, language = "English", humanize = false } = req.body;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        const prompt = prompts.getGrammarFixPrompt(language, humanize);
        const resultText = await aiService.callGroqAPI(prompt, text, 0.2);
        sendResponse(res, true, resultText, null, { language, humanize });
    } catch (error) {
        res.status(500).json({ success: false, error: { message: error.message } });
    }
};

const suggestions = async (req, res, next) => {
    try {
        const { text, language = "English" } = req.body;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });
        const prompt = prompts.getSuggestionsPrompt(language);
        const resultText = await aiService.callGroqAPI(prompt, text, 0.5);
        let parsedSuggestions = [];
        try {
            const jsonMatch = resultText.match(/\[.*\]/s);
            parsedSuggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [resultText];
        } catch (e) { parsedSuggestions = [resultText]; }
        sendResponse(res, true, parsedSuggestions, null, { language });
    } catch (error) {
        res.status(500).json({ success: false, error: { message: "Failed to get suggestions" } });
    }
};

const autocomplete = async (req, res, next) => {
    try {
        const { context, partial_word, language = "English" } = req.body;
        if (!context) return res.status(400).json({ success: false, error: { message: "Context is required" } });
        const prompt = prompts.getAutocompletePrompt(context, language);
        const resultText = await aiService.callGroqAPI(prompt, partial_word || "", 0.3);
        sendResponse(res, true, resultText.replace(/^[\"']|[\"']$/g, '').trim(), null, { language });
    } catch (error) {
        res.status(500).json({ success: false, error: { message: "Autocomplete failed" } });
    }
};

// Phase 3: Sentence-level realtime (PRESERVED, UNCHANGED)
const analyzeRealtime = async (req, res, next) => {
    try {
        let { text, language = "English", humanize = false } = req.body;
        if (!text || text.trim().length < 3) return sendResponse(res, true, []);

        if (language === "Auto" || language === "Auto-Detect") {
            const hasHindi = /[\u0900-\u097F]/.test(text);
            const hasTelugu = /[\u0C00-\u0C7F]/.test(text);
            const hasKannada = /[\u0CB0-\u0CFF]/.test(text);
            if (hasHindi) language = "Hindi";
            else if (hasTelugu) language = "Telugu";
            else if (hasKannada) language = "Kannada";
            else {
                const hinglishKeywords = ["hai", "hoon", "tha", "kya", "toh", "yaar", "bhai", "acha", "nahi", "mein", "kar", "hota", "hain"];
                const isHinglish = text.toLowerCase().split(/\W+/).some(w => hinglishKeywords.includes(w));
                language = isHinglish ? "Hinglish" : "English";
            }
        }

        const prompt = prompts.getStableRealtimePrompt(language, humanize);
        const resultText = await aiService.callGroqAPI(prompt, text, 0.4);

        let suggestionsList = [];
        try {
            const jsonMatch = resultText.match(/\[[\s\S]*\]/);
            suggestionsList = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) { suggestionsList = []; }

        sendResponse(res, true, suggestionsList, null, { language, humanize });
    } catch (error) {
        console.error("[Realtime] Error:", error.message);
        res.status(500).json({ success: false, error: { message: "Real-time analysis failed" } });
    }
};

// ─────────────────────────────────────────────
// Phase 4: Smart Suggestions Engine
// ─────────────────────────────────────────────

// Intent-to-category priority affinity matrix
const INTENT_PRIORITY = {
    professional: { Grammar: 5, Clarity: 5, Flow: 4, Transition: 3, Tone: 2, Authenticity: 1 },
    casual:       { Authenticity: 5, Tone: 4, Flow: 4, Clarity: 3, Grammar: 2, Transition: 2 },
    emotional:    { Tone: 5, Authenticity: 5, Flow: 3, Clarity: 2, Transition: 2, Grammar: 1 },
    neutral:      { Clarity: 4, Flow: 4, Grammar: 3, Tone: 3, Authenticity: 3, Transition: 2 }
};

const rankSuggestions = (suggestions, writingContext = {}) => {
    const intent = writingContext.intent || 'neutral';
    const priorityMap = INTENT_PRIORITY[intent] || INTENT_PRIORITY.neutral;

    return suggestions
        .filter(s => (s.confidence || 0.5) >= 0.4)
        .sort((a, b) => {
            // 1. AI-assigned priority (highest weight)
            const aiDiff = (b.priority || 3) - (a.priority || 3);
            if (aiDiff !== 0) return aiDiff;
            // 2. Intent-category affinity
            const intentDiff = (priorityMap[b.category] || 3) - (priorityMap[a.category] || 3);
            if (intentDiff !== 0) return intentDiff;
            // 3. Confidence as tiebreaker
            return (b.confidence || 0.5) - (a.confidence || 0.5);
        })
        .slice(0, 5); // Never more than 5 — calm, not overwhelming
};

const analyzeSmartSuggestions = async (req, res, next) => {
    try {
        let { text, language = "English", humanize = false, writingContext = {} } = req.body;
        if (!text || text.trim().length < 10) return sendResponse(res, true, []);

        // Auto language detection (consistent with analyzeRealtime)
        if (language === "Auto" || language === "Auto-Detect") {
            const hasHindi = /[\u0900-\u097F]/.test(text);
            const hasTelugu = /[\u0C00-\u0C7F]/.test(text);
            const hasKannada = /[\u0CB0-\u0CFF]/.test(text);
            if (hasHindi) language = "Hindi";
            else if (hasTelugu) language = "Telugu";
            else if (hasKannada) language = "Kannada";
            else {
                const hinglishKeywords = ["hai", "hoon", "tha", "kya", "toh", "yaar", "bhai", "acha", "nahi", "mein", "kar", "hota", "hain"];
                const words = text.toLowerCase().split(/\W+/);
                const hinglishCount = words.filter(w => hinglishKeywords.includes(w)).length;
                language = hinglishCount >= 2 ? "Hinglish" : "English";
            }
            console.log(`[Smart] Auto-detected: ${language}`);
        }

        console.log(`[Smart] Analyzing. Lang: ${language}, Intent: ${writingContext.intent || '?'}, Words: ${writingContext.wordCount || '?'}`);

        const prompt = prompts.getSmartSuggestionsPrompt(language, humanize, writingContext);
        // Lower temperature (0.35) for focused, consistent suggestions
        const resultText = await aiService.callGroqAPI(prompt, text, 0.35);

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

        sendResponse(res, true, ranked, null, {
            language,
            humanize,
            intent: writingContext.intent,
            mode: 'smart'
        });
    } catch (error) {
        console.error("[Smart] Error:", error.message);
        res.status(500).json({ success: false, error: { message: "Smart analysis failed" } });
    }
};

module.exports = {
    rewrite,
    grammarFix,
    suggestions,
    autocomplete,
    analyzeRealtime,
    analyzeSmartSuggestions  // Phase 4
};
