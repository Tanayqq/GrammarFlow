const aiService = require('../services/ai.service');
const prompts = require('../config/prompts');

// Helper for standardized API responses
const sendResponse = (res, success, data = null, error = null, metadata = {}) => {
    const response = {
        success,
        data,
        error: error ? {
            message: error.message || error,
            code: error.code || (success ? null : 'INTERNAL_ERROR')
        } : null,
        metadata: {
            timestamp: new Date().toISOString(),
            version: 'v1',
            ...metadata
        }
    };
    res.json(response);
};

const rewrite = async (req, res, next) => {
    try {
        const { text, style = "Casual", tone = "Friendly", language = "English", humanize = false } = req.body;
        
        if (!text) {
            return res.status(400).json({ 
                success: false, 
                error: { message: "Text is required", code: "MISSING_INPUT" } 
            });
        }
        
        console.log(`[API v1] Processing /rewrite. Lang: ${language}, Humanize: ${humanize}`);
        
        let resultText = "";
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts) {
            let prompt = prompts.getRewritePrompt(style, tone, language, humanize);
            
            if (attempts > 0) {
                prompt = `CRITICAL: Previous response was invalid. Provide exactly 3 numbered rewrites in ${language} now.\n\n${prompt}`;
            }

            try {
                resultText = await aiService.callGroqAPI(prompt, text, 0.7);
                if (resultText.trim().length > 0 && !resultText.toLowerCase().includes("sorry")) break;
            } catch (err) {
                if (attempts === maxAttempts - 1) throw err;
            }
            attempts++;
        }

        resultText = resultText.replace(/^(STRICT COMMAND|IMPORTANT|CRITICAL|STRICT|Note):.*?\n/gsi, '').trim();

        const lines = resultText.split('\n').map(l => l.trim()).filter(l => l);
        let rewrites = [];
        for (const line of lines) {
            const match = line.match(/^[1-3][\.\)]\s*(.*)/);
            if (match) rewrites.push(match[1].trim());
        }

        if (rewrites.length === 0) rewrites = [resultText];

        sendResponse(res, true, rewrites.slice(0, 3), null, { language, humanize });

    } catch (error) {
        console.error("[API v1] Rewrite error:", error.message);
        res.status(500).json({ 
            success: false, 
            error: { message: error.message, code: "AI_PROCESSING_ERROR" } 
        });
    }
};

const grammarFix = async (req, res, next) => {
    try {
        const { text, language = "English", humanize = false } = req.body;
        if (!text) return res.status(400).json({ success: false, error: { message: "Text is required" } });

        let resultText = "";
        try {
            const prompt = prompts.getGrammarFixPrompt(language, humanize);
            resultText = await aiService.callGroqAPI(prompt, text, 0.2);
        } catch (err) {
            throw err;
        }
        
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
        } catch (e) {
            parsedSuggestions = [resultText];
        }

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

        sendResponse(res, true, resultText.replace(/^["']|["']$/g, '').trim(), null, { language });
    } catch (error) {
        res.status(500).json({ success: false, error: { message: "Autocomplete failed" } });
    }
};

const analyzeRealtime = async (req, res, next) => {
    try {
        const { text, language = "English", humanize = false } = req.body;
        if (!text || text.trim().length < 3) {
            return sendResponse(res, true, []); // Return empty if too short
        }

        const prompt = prompts.getStableRealtimePrompt(language, humanize);
        const resultText = await aiService.callGroqAPI(prompt, text, 0.4);

        let suggestions = [];
        try {
            const jsonMatch = resultText.match(/\[.*\]/s);
            suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        } catch (e) {
            console.error("[Real-time] Failed to parse AI response:", resultText);
            suggestions = [];
        }

        sendResponse(res, true, suggestions, null, { language, humanize });
    } catch (error) {
        console.error("[Real-time] Error:", error.message);
        res.status(500).json({ success: false, error: { message: "Real-time analysis failed" } });
    }
};

module.exports = {
    rewrite,
    grammarFix,
    suggestions,
    autocomplete,
    analyzeRealtime
};
