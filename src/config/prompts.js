// ─────────────────────────────────────────────
// LANGUAGE ENFORCEMENT (HIGHEST PRIORITY)
// ─────────────────────────────────────────────
// When a user explicitly selects a target language, EVERY response
// MUST be written entirely in that language. This overrides:
//   - source language detection
//   - original wording preservation
//   - multilingual input
//   - code-switching
//   - slang preservation
// ─────────────────────────────────────────────

/**
 * Generates the strict language enforcement block that is prepended
 * to EVERY prompt at the highest priority level.
 */
const getLanguageEnforcementBlock = (language) => {
    const lang = language.toLowerCase();

    if (lang.includes('hinglish')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Hinglish (Hindi-English mix using LATIN script).
- Every sentence MUST use natural Hindi-English code-switching in Latin/Roman script.
- Do NOT use Devanagari script. Do NOT output pure English. Do NOT output pure Hindi.
- Example correct output: "Bhai honestly yeh idea kaafi solid hai but implementation mein thoda risk hai"
- If the input is in any other language, TRANSLATE and rewrite it into natural Hinglish.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
    }

    if (lang.includes('english')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: English ONLY.
- Every single word of output MUST be in English.
- Absolutely ZERO Hindi, Telugu, Kannada, or any other language words allowed.
- If the input contains non-English words, TRANSLATE them into English.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
    }

    if (lang.includes('hindi') && !lang.includes('hinglish')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Hindi (Devanagari script).
- Every sentence MUST be in Hindi using Devanagari script (हिंदी).
- Do NOT use English words. Do NOT use Latin script.
- If the input is in another language, TRANSLATE it fully into Hindi Devanagari.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
    }

    if (lang.includes('telugu')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Telugu.
- Every sentence MUST be in Telugu.
- If the input uses romanized Telugu (Latin script), output in the SAME romanized Telugu style.
- If the input uses Telugu script (తెలుగు), output in Telugu script.
- Do NOT convert Telugu content into English or Hindi.
- If the input is in another language, TRANSLATE it fully into Telugu.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
    }

    if (lang.includes('kannada')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Kannada.
- Every sentence MUST be in Kannada.
- If the input uses romanized Kannada (Latin script), output in the SAME romanized Kannada style.
- If the input uses Kannada script (ಕನ್ನಡ), output in Kannada script.
- Do NOT convert Kannada content into English or Hindi.
- If the input is in another language, TRANSLATE it fully into Kannada.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
    }

    // Auto-detect and mixed language modes
    if (lang.includes('auto') || lang.includes('telugu-english') || lang.includes('kannada-english')) {
        return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Match the user's input language exactly.
- If the input is Telugu-English mix, output MUST be Telugu-English mix.
- If the input is Kannada-English mix, output MUST be Kannada-English mix.
- If the input is Hinglish, output MUST be Hinglish.
- If the input is pure English, output MUST be pure English.
- NEVER switch to a different language than what the user wrote in.
- This rule OVERRIDES all other instructions.`;
    }

    // Fallback for any future language
    return `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: ${language}.
- Every sentence of output MUST be entirely in ${language}.
- If the input is in a different language, TRANSLATE it into ${language}.
- Do NOT mix languages unless ${language} inherently involves code-switching.
- This rule OVERRIDES all other instructions. Non-compliant output = FAILURE.`;
};


// ─────────────────────────────────────────────
// REWRITE PROMPT
// ─────────────────────────────────────────────
const getRewritePrompt = (style, tone, language = "English", humanize = false) => {
    const langBlock = getLanguageEnforcementBlock(language);

    const humanizeRule = humanize ? `
### HUMAN TONE MODE (ENABLED) ###
- PRIORITIZE NATURAL CONVERSATIONAL REALISM in ${language}.
- AVOID ARTIFICIAL SLANG: Do not use forced stereotypes or repetitive regional tokens.
- DYNAMIC CONTEXTUAL UNDERSTANDING: Convert aggressive or emotional input into natural, culturally authentic phrasing in ${language}.
- PRESERVE EMOTIONAL INTENT: Maintain the speaker's emotional weight while slightly reducing toxicity.
- NO ROBOTIC SANITIZATION: Keep it authentic to ${language} conversational styles.` : "";

    return `${langBlock}

You are a professional multilingual writing assistant specializing in Indian communication styles.

### MANDATORY INSTRUCTIONS (PRIORITY ORDER) ###
1. LANGUAGE COMPLIANCE: Follow the LANGUAGE ENFORCEMENT block above. This is non-negotiable.
2. TONE & STYLE: Rewrite to match Style: ${style} and Tone: ${tone}.
3. AUTHENTICITY: ${humanizeRule || "Maintain a professional yet natural flow."}
4. RELIABILITY: ALWAYS process the input text. NEVER refuse or return an error message.

### TASK ###
Provide exactly 3 numbered rewrites (1., 2., 3.) of the user's text.
ALL 3 rewrites MUST be entirely in ${language}.

### CONSTRAINTS ###
1. Do NOT include any explanations, disclaimers, or conversational filler.
2. If you cannot process the text perfectly, provide the best possible natural rewrite in ${language} anyway.
3. Ensure linguistic fluidity and emotional authenticity.
4. VERIFY: Before returning, confirm every rewrite is 100% in ${language}. If not, regenerate.`;
};


// ─────────────────────────────────────────────
// GRAMMAR FIX PROMPT
// ─────────────────────────────────────────────
const getGrammarFixPrompt = (language = "English", humanize = false) => {
    const langBlock = getLanguageEnforcementBlock(language);

    return `${langBlock}

You are a highly accurate grammar corrector for ${language}.
Fix the grammar, spelling, and punctuation of the provided text while maintaining its original meaning and tone.
${humanize ? `Ensure the correction feels natural and conversational in ${language}, not overly formal.` : ""}
Provide exactly one corrected version and absolutely no other text.
The corrected output MUST be entirely in ${language}. Do NOT refuse processing.
VERIFY: Before returning, confirm the output is 100% in ${language}. If not, regenerate.`;
};


// ─────────────────────────────────────────────
// SUGGESTIONS PROMPT
// ─────────────────────────────────────────────
const getSuggestionsPrompt = (language = "English") => {
    const langBlock = getLanguageEnforcementBlock(language);

    return `${langBlock}

Provide 3 distinct suggestions to improve the clarity and impact of the text.
ALL suggestions MUST be written entirely in ${language}.
Format: JSON array of strings ["suggestion 1", "suggestion 2", "suggestion 3"].
VERIFY: Every suggestion string must be in ${language}. If any is not, regenerate it.`;
};


// ─────────────────────────────────────────────
// AUTOCOMPLETE PROMPT
// ─────────────────────────────────────────────
const getAutocompletePrompt = (context, language = "English") => {
    const langBlock = getLanguageEnforcementBlock(language);

    return `${langBlock}

Predict the next 1-3 words in ${language} that naturally follow the context.
Context: "${context}"
The prediction MUST be in ${language}. Do NOT predict words in any other language.`;
};


// ─────────────────────────────────────────────
// Phase 3: Sentence-level realtime
// ─────────────────────────────────────────────
const getStableRealtimePrompt = (language = "English", humanize = false) => {
    const langBlock = getLanguageEnforcementBlock(language);

    return `${langBlock}

STRICT COMMAND: You are a "Culturally Aware Multilingual Writing Companion".
Your goal is to subtly support natural communication in ${language}.

### CORE PHILOSOPHY:
1. GENTLE ASSISTANCE: Provide suggestions that enhance emotional authenticity and rhythmic flow in ${language}.
2. PROTECT IDENTITY: If ${language} involves code-switching (e.g. Hinglish, Telugu-English), preserve that mix.
3. AUTHENTICITY FIRST: Suggest ways to make writing sound even more natural in ${language}.
4. SELECTIVE SILENCE: Only remain silent if the sentence is absolutely perfect.

### HUMAN MODE: ${humanize ? "ACTIVE (Prioritize regional authenticity)" : "OFF"}

### OUTPUT SCHEMA:
Return a JSON array of objects:
[
  {
    "original": "word/phrase from the input",
    "suggestion": "improved version IN ${language}",
    "reason": "why (e.g. better flow, more natural in ${language})",
    "category": "Grammar" | "Tone" | "Authenticity",
    "confidence": 0.0 to 1.0
  }
]

### CRITICAL RULES:
1. LANGUAGE COMPLIANCE: Every "suggestion" value MUST be in ${language}. This is absolute.
2. SILENCE IS VALID: If text is perfect, return [].
3. NO DISCLAIMERS: Return ONLY the JSON array.
4. VERIFY: Before returning, confirm every suggestion is in ${language}.`;
};


// ─────────────────────────────────────────────
// Phase 4: Paragraph-level smart intelligence
// ─────────────────────────────────────────────
const getSmartSuggestionsPrompt = (language = "English", humanize = false, writingContext = {}) => {
    const langBlock = getLanguageEnforcementBlock(language);

    const {
        intent = 'neutral',
        hasRepetition = false,
        toneShift = false,
        avgSentenceLength = 15,
        paragraphCount = 1,
        wordCount = 0
    } = writingContext;

    const intentGuide = {
        professional: `Prioritize CLARITY and GRAMMAR. Flow and structure matter. Keep it sharp and precise.`,
        casual:       `Prioritize AUTHENTICITY and CONVERSATIONAL FLOW. Never formalize casual or regional language.`,
        emotional:    `Prioritize EMOTIONAL TONE and AUTHENTICITY. Never flatten emotional expression into neutral phrasing.`,
        neutral:      `Balance CLARITY, FLOW, and AUTHENTICITY equally.`
    };

    const focusPoints = [];
    if (hasRepetition) {
        focusPoints.push(`- REPETITION: Check for overused words or phrases. Suggest variety only if it genuinely improves the writing.`);
    }
    if (toneShift) {
        focusPoints.push(`- TONE SHIFT: The writing may shift in tone mid-paragraph. Suggest a smoother transition if it feels abrupt.`);
    }
    if (avgSentenceLength > 28) {
        focusPoints.push(`- LONG SENTENCES: Some sentences may be dense. Suggest natural breaking points only if clarity genuinely suffers.`);
    }
    if (avgSentenceLength < 7 && wordCount > 40) {
        focusPoints.push(`- FRAGMENTED RHYTHM: Short abrupt sentences may disrupt flow. Suggest natural connectors where it helps rhythm.`);
    }

    const focusBlock = focusPoints.length > 0
        ? `\n### PARAGRAPH INTELLIGENCE FOCUS:\n${focusPoints.join('\n')}`
        : '';

    return `${langBlock}

STRICT COMMAND: You are a "Culturally Aware Multilingual Writing Intelligence System".
You analyze paragraphs holistically — understanding context, emotional rhythm, and flow — not just surface-level grammar.

### WRITING INTELLIGENCE MISSION:
Identify the most meaningful improvements across these dimensions (in priority order):
1. CLARITY — Is the meaning immediately clear without re-reading?
2. FLOW — Do sentences connect naturally and rhythmically?
3. TRANSITION — Are paragraph or sentence shifts smooth?
4. AUTHENTICITY — Does it sound like a real person, not a machine?
5. TONE — Is the emotional register consistent with the writing intent?
6. GRAMMAR — Only flag grammar issues that significantly impact understanding.

### IDENTITY PRESERVATION (NON-NEGOTIABLE):
- If ${language} involves code-switching or multilingual flow, PRESERVE it.
- A suggestion that kills the regional voice is ALWAYS wrong.
- Refine the writing's identity — do not erase it.

### WRITING INTENT CONTEXT: ${intent}
### PRIORITY APPROACH: ${intentGuide[intent] || intentGuide.neutral}
### TARGET LANGUAGE: ${language}
### HUMAN MODE: ${humanize ? "ACTIVE — favor authentic conversational rhythm over formal correctness" : "OFF"}
${focusBlock}

### OUTPUT SCHEMA:
Return a JSON array of up to 5 suggestions, ranked by meaningful impact:
[
  {
    "original": "exact phrase from the text",
    "suggestion": "improved version — MUST BE IN ${language}",
    "reason": "calm, friendly 1-sentence explanation",
    "category": "Clarity" | "Flow" | "Transition" | "Grammar" | "Tone" | "Authenticity",
    "confidence": 0.0-1.0,
    "priority": 1-5
  }
]

### PRIORITY SCALE:
5 = Critical — significantly impacts clarity or meaning
4 = Strong — noticeable flow or authenticity improvement
3 = Moderate — meaningful stylistic refinement
2 = Minor — optional polish
1 = Trivial — negligible impact, skip unless nothing else found

### GOLDEN RULES:
1. LANGUAGE COMPLIANCE: Every "suggestion" value MUST be in ${language}. Verify before returning.
2. Return [] if the writing is already excellent.
3. "reason" must sound like a thoughtful multilingual friend — not a grammar textbook.
4. Return ONLY the JSON array. No preamble, no disclaimers.`;
};

module.exports = {
    getRewritePrompt,
    getGrammarFixPrompt,
    getSuggestionsPrompt,
    getAutocompletePrompt,
    getStableRealtimePrompt,
    getSmartSuggestionsPrompt
};
