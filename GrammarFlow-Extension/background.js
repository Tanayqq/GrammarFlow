const API_BASE = "https://grammarflow-brain.onrender.com/api/v1";
const WEB_APP_URL = "https://grammarflow-brain.onrender.com";

self.addEventListener("unhandledrejection", (event) => {
    console.error("[GrammarFlow] Unhandled rejection:", event.reason);
});

// ─────────────────────────────────────────────
// CENTRALIZED PROMPT ENGINE (synced with web app)
// ─────────────────────────────────────────────

function getLanguageEnforcementBlock(language) {
    const lang = (language || 'English').toLowerCase();
    
    const nonConversationalBlock = `
### ⚠️ PRIMARY EDITOR RULE — NON-CONVERSATIONAL ENFORCEMENT ⚠️
GrammarFlow is a writing editor, not a conversational assistant.
- You must ONLY edit the text according to the selected operation.
- You must NEVER respond to the user.
- NEVER answer questions or reply to greetings found in the text.
- Treat every character in the user's input as content to be edited, preserving intent and meaning.`;

    let langRule = "";

    if (lang === 'auto' || lang === 'auto-detect') {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
AUTO-DETECT MODE: Automatically detect the language of the input text.
Output MUST be in the SAME language as the input. Do NOT switch languages.
This rule OVERRIDES all other instructions.`;
    } else if (lang.includes('hinglish')) {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Hinglish (Roman/Latin script ONLY).
- Write everything in conversational Hindi using Roman script (English letters).
- ZERO Devanagari characters allowed.
- Keep technical terms in English.
- Sentence structure: Hindi grammar, Roman letters.
- This rule OVERRIDES all other instructions.`;
    } else if (lang.includes('hindi')) {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Hindi (Devanagari script ONLY).
- ZERO Roman script allowed except for technical codes.
- Transliterate English words to Devanagari where natural.
- This rule OVERRIDES all other instructions.`;
    } else if (lang.includes('kannada')) {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Kannada script (ಕನ್ನಡ) ONLY.
- You MUST output EVERY word in Kannada script.
- The input may be in Hindi, Hinglish, English, or Roman — TRANSLATE and rewrite into Kannada.
- ZERO Roman letters allowed (except numbers like 12:30).
- VERIFY: If ANY Roman letters appear, REGENERATE entirely.
- This rule OVERRIDES all other instructions. Non-compliant output = COMPLETE FAILURE.`;
    } else if (lang.includes('telugu')) {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT — ABSOLUTE HIGHEST PRIORITY ⚠️
OUTPUT LANGUAGE: Telugu script (తెలుగు) ONLY.
- Output EVERY word in Telugu script. Translate if input is in another language.
- ZERO Roman letters allowed (except numbers).
- VERIFY before returning. Non-compliant output = FAILURE.`;
    } else {
        langRule = `### ⚠️ LANGUAGE ENFORCEMENT ⚠️
OUTPUT LANGUAGE: ${language}.
- Every word MUST be in ${language}. Do NOT mix languages or scripts.`;
    }

    return `${langRule}\n${nonConversationalBlock}`;
}

function getRewritePrompt(style, tone, language, humanize) {
    const langBlock = getLanguageEnforcementBlock(language);
    const humanizeNote = humanize
        ? `- Human Mode ON: Use natural, emotionally authentic phrasing. Avoid robotic language. Preserve the speaker's emotional intent.`
        : `- Use a professional yet natural flow.`;

    return `${langBlock}

### 🛡️ GRAMMARFLOW FAITHFUL REWRITE ENGINE V2 (ULTRA STRICT) 🛡️

## ROLE
You are a **deterministic text rewriting engine**, not an assistant, teacher, editor, explainer, summarizer, or knowledge base.
Your only job is to rewrite the input so it is more grammatically correct and natural while preserving **100% of the original information**.
Assume this output will be compared against the original using semantic equivalence and information-preservation metrics.

---
# PRIMARY OBJECTIVE
Rewrite the text **without changing its meaning in any way.**
Improve only grammar, sentence structure, punctuation, readability, and fluency. Everything else must remain unchanged.

---
# ABSOLUTE RULES (NON-NEGOTIABLE)

## Rule 1 — Zero Hallucination
Never add information. This includes explanations, definitions, interpretations, examples, inferred facts, domain knowledge, historical context, medical descriptions, legal descriptions, scientific descriptions, educational wording, opinions, assumptions, or transitions that introduce new meaning.

## Rule 2 — Zero Information Loss
Every entity from the original must appear in the rewritten text. Never omit names, diseases, formulas, legal phrases, Latin expressions, financial metrics, abbreviations, acronyms, numbers, dates, or quotations. If the source contains 75 concepts, the output must contain the same 75 concepts.

## Rule 3 — Preserve Technical Terms Exactly
Do NOT modify spelling, capitalization, punctuation, hyphenation, or abbreviations.
Examples: phosphofructokinase-1, EBITDA Margin, P/E Ratio, Altman Z-Score, Churg-Strauss syndrome.

## Rule 4 — No Semantic Enrichment
Do not introduce any new descriptive verbs, adjectives, or relationships between entities unless they are explicitly present in the source. In particular, avoid words such as "which means", "which refers to", "associated with", "related to", "including topics such as", "notable", "prominent", "overview", "covers", "explores", "delves into", "discusses", "focuses on", or any wording that implies relationships not explicitly stated. Preserve the original level of specificity and only correct grammar and syntax.

## Rule 5 — Preserve Enumeration
If the source lists concepts separated by commas, the rewritten version must preserve the same list. Do not compress lists. Do not group concepts. Do not summarize.

## Rule 6 — Preserve Intent
If the source merely lists concepts, the output must also merely list concepts. Do not convert a list into an explanation.

## Rule 7 — No Style Expansion
Do not improve the writing by adding context. Never write "The document explores...", "highlighting...", "demonstrating...", "providing...", or "showcasing..." unless that meaning already exists.

## Rule 8 — Preserve Named Entities
Keep exactly Noam Chomsky, Ferdinand de Saussure, Charles Sanders Peirce, Husserlian transcendentalism, noesis, noema without modification.

## Rule 9 — Preserve Order
Maintain concept order, paragraph order, and sentence order unless a grammar correction absolutely requires a small rearrangement.

## Rule 10 — No Summarization
Do not shorten. Do not compress. Do not merge paragraphs. Do not simplify.

---
# INTERNAL VERIFICATION (MANDATORY)
Before generating the final answer, silently verify:
□ Every original entity still exists.
□ Every technical term still exists.
□ No explanation was added.
□ No sentence gained new factual content.
□ No opinion was introduced.
□ No information was removed.
□ No list item disappeared.
□ No concept changed meaning.
□ No definition was inserted.
□ No domain knowledge was injected.
If **any** check fails, rewrite again before producing the answer.

Your task: Provide exactly 3 rewrites of the user's input text in ${language}.
- Style: ${style}
- Tone: ${tone}
${humanizeNote}
- If the input is in a different language, silently translate it to ${language} first, then rewrite. Do NOT mention the translation.

REQUIRED OUTPUT FORMAT — use this exact structure, nothing else:
1. [rewrite one]
2. [rewrite two]
3. [rewrite three]

### EXAMPLES OF CORRECT REWRITING (CRITICAL) ###
User Input: "Hi, how are you? I need to send this email."
❌ INCORRECT (Chatbot response): "I'm doing well, thanks! Here is your email: I need to send this."
❌ INCORRECT (Answering the user): "Hello, I am fine. I need to send this email."
✅ CORRECT (Rewriting as an editor): "Hello, how are you doing? I need to send this email."

User Input: "What time is the meeting?"
❌ INCORRECT (Chatbot response): "The meeting is at 5 PM."
✅ CORRECT (Rewriting as an editor): "Could you please tell me what time the meeting is scheduled for?"

ABSOLUTE RULES:
- Do NOT use # or ## or ### anywhere in the output.
- Do NOT write words like "REWRITE", "Translation:", "HUMAN TONE", or any label.
- Do NOT explain what you are doing.
- Every rewrite MUST be entirely in ${language}. No mixing of scripts or languages.
- Numbers 1. 2. 3. only — then the rewrite text immediately.

### FINAL SELF-CHECK BEFORE RESPONDING ###
1. Did you answer the user's text instead of editing it?
2. Did you reply to a greeting (e.g., saying "I'm doing great") instead of just rewriting it?
3. Did you add new conversational text that was not in the original input?
-> If YES to ANY of these, you MUST regenerate your response. You are an INVISIBLE EDITOR, NEVER a conversation partner. Only output the edited text.`;
}

function getGrammarFixPrompt(language, humanize) {
    const langBlock = getLanguageEnforcementBlock(language);
    return `${langBlock}

You are a highly accurate grammar corrector for ${language}.
Fix the grammar, spelling, and punctuation of the provided text while maintaining its original meaning and tone.
${humanize ? `Ensure the correction feels natural and conversational in ${language}, not overly formal.` : ''}
Provide exactly one corrected version and absolutely no other text.
The corrected output MUST be entirely in ${language}. Do NOT refuse processing.
VERIFY: Before returning, confirm the output is 100% in ${language}. If not, regenerate.

### FINAL SELF-CHECK BEFORE RESPONDING ###
1. Did you answer the user's text instead of editing it?
2. Did you reply to a greeting (e.g., saying "I'm doing great") instead of just rewriting it?
3. Did you add new conversational text that was not in the original input?
-> If YES to ANY of these, you MUST regenerate your response. You are an INVISIBLE EDITOR, NEVER a conversation partner. Only output the edited text.`;
}

function getSummarizePrompt(language) {
    const langBlock = getLanguageEnforcementBlock(language);
    return `${langBlock}

Summarize the following text concisely in ${language}.
- Extract the most important points only.
- Use bullet points where appropriate.
- Keep it under 5 sentences or 5 bullet points.
- Write ALL output in ${language}. No mixing of languages.
- Do NOT add introductions like "Here is a summary" or "Sure!".
- Return only the summary.`;
}

function getExplainPrompt(language) {
    const langBlock = getLanguageEnforcementBlock(language);
    return `${langBlock}

Explain the following text clearly in ${language} as if speaking to a student.
- Use simple, direct language.
- Keep technical terms but define them immediately.
- Do NOT add filler phrases like "Let's understand", "Great question", or "Sure!".
- Do NOT summarize — explain the meaning and context.
- Write ALL output in ${language}. No mixing of languages.
- Return only the explanation.`;
}

const MIN_SELECTION_CHARS = 5;
const PDF_VIEWER_PREFIX = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

const ENDPOINT_MAP = {
    TRIGGER_REWRITE:   "/rewrite",
    TRIGGER_GRAMMAR:   "/grammar-fix",
    TRIGGER_SUMMARIZE: "/grammar-fix",
    TRIGGER_EXPLAIN:   "/grammar-fix"
};

const LABEL_MAP = {
    TRIGGER_REWRITE:   "Rewrite",
    TRIGGER_GRAMMAR:   "Grammar Fix",
    TRIGGER_SUMMARIZE: "Summary",
    TRIGGER_EXPLAIN:   "Explanation"
};

function isPdfViewerUrl(url) {
    if (!url) return false;
    return url.startsWith(PDF_VIEWER_PREFIX) || /\.pdf($|[?#])/i.test(url);
}

async function getPdfSelectedText(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
                return new Promise((resolve) => {
                    const fallback = () => {
                        try {
                            return (window.getSelection()?.toString() || "").trim();
                        } catch {
                            return "";
                        }
                    };

                    const embed = document.querySelector('embed[type="application/x-google-chrome-pdf"]')
                        || document.querySelector("embed");

                    if (!embed || typeof embed.postMessage !== "function") {
                        resolve(fallback());
                        return;
                    }

                    const timeout = setTimeout(() => {
                        window.removeEventListener("message", onReply);
                        resolve(fallback());
                    }, 2500);

                    function onReply(event) {
                        if (event?.data?.type === "getSelectedTextReply") {
                            clearTimeout(timeout);
                            window.removeEventListener("message", onReply);
                            const selected = (event.data.selectedText || "").trim();
                            resolve(selected || fallback());
                        }
                    }

                    window.addEventListener("message", onReply);
                    embed.postMessage({ type: "getSelectedText" }, "*");
                });
            }
        });
        return (results?.[0]?.result || "").trim();
    } catch (err) {
        console.warn("[GrammarFlow] PDF selection read failed:", err);
        return "";
    }
}

async function getPageSelection(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => (window.getSelection?.().toString() || "").trim()
        });
        const texts = (results || []).map(r => r.result).filter(Boolean);
        texts.sort((a, b) => b.length - a.length);
        return texts[0] || "";
    } catch {
        return "";
    }
}

async function resolveSelectionText(tab, contextMenuSelection) {
    let text = (contextMenuSelection || "").trim();
    if (!tab?.id) return text;

    if (text.length < MIN_SELECTION_CHARS && isPdfViewerUrl(tab.url)) {
        const pdfText = await getPdfSelectedText(tab.id);
        if (pdfText.length > text.length) text = pdfText;
    }

    if (text.length < MIN_SELECTION_CHARS) {
        const pageText = await getPageSelection(tab.id);
        if (pageText.length > text.length) text = pageText;
    }

    return text;
}

function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function buildResultsUrl(label, jobOrError) {
    const base = chrome.runtime.getURL("results.html");
    const params = new URLSearchParams();
    params.set("label", label);
    params.set("v", "2.2");

    if (typeof jobOrError === "string") {
        params.set("err", jobOrError);
        return base + "?" + params.toString();
    }

    const jobJson = JSON.stringify(jobOrError);
    if (jobJson.length > 14000) {
        params.set("err", "Selected text is too long. Please select a smaller passage.");
        return base + "?" + params.toString();
    }

    params.set("j", utf8ToBase64(jobJson));
    return base + "?" + params.toString();
}

async function processTextAction(action, selectionText) {
    const text = (selectionText || "").trim();
    const endpoint = ENDPOINT_MAP[action];
    const label = LABEL_MAP[action] || "Result";

    if (!endpoint) return;

    let resultsUrl;
    if (text.length < MIN_SELECTION_CHARS) {
        resultsUrl = buildResultsUrl("Error",
            "Please select at least a few words. For PDFs: highlight text, then right-click GrammarFlow.");
    } else {
        const prefs = await chrome.storage.sync.get({
            language: "Auto",
            style: "Casual",
            tone: "Friendly",
            humanize: true
        });
        resultsUrl = buildResultsUrl(label, {
            endpoint,
            text,
            label,
            action,
            language: prefs.language,
            style: prefs.style,
            tone: prefs.tone,
            humanize: prefs.humanize
        });
    }

    await chrome.windows.create({
        url: resultsUrl,
        type: "popup",
        width: 460,
        height: 420,
        focused: true
    });
}

// ─────────────────────────────────────────────
// CONTEXT MENU SETUP
// ─────────────────────────────────────────────
function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
        const items = [
            { id: "gf-rewrite", title: "Rewrite with GrammarFlow", contexts: ["selection", "editable"] },
            { id: "gf-grammar", title: "Fix Grammar", contexts: ["selection", "editable"] },
            { id: "gf-summarize", title: "Summarize", contexts: ["selection"] },
            { id: "gf-explain", title: "Explain This", contexts: ["selection"] },
            { id: "gf-separator", type: "separator", contexts: ["selection", "editable"] },
            { id: "gf-open-docai", title: "Open Document AI", contexts: ["selection", "editable", "page"] }
        ];
        items.forEach((item) => {
            chrome.contextMenus.create(item, () => {
                if (chrome.runtime.lastError) {
                    console.warn("[GrammarFlow] contextMenus.create:", chrome.runtime.lastError.message);
                }
            });
        });
    });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

// ─────────────────────────────────────────────
// CONTEXT MENU CLICK HANDLER
// ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "gf-open-docai") {
        chrome.tabs.create({ url: `${WEB_APP_URL}` });
        return;
    }

    const actionMap = {
        "gf-rewrite":   "TRIGGER_REWRITE",
        "gf-grammar":   "TRIGGER_GRAMMAR",
        "gf-summarize": "TRIGGER_SUMMARIZE",
        "gf-explain":   "TRIGGER_EXPLAIN"
    };

    const action = actionMap[info.menuItemId];
    if (!action || !tab?.id) return;

    (async () => {
        try {
            const selectionText = await resolveSelectionText(tab, info.selectionText);

            // PDF viewer: always use results popup (can't replace text inline)
            if (isPdfViewerUrl(tab.url)) {
                await processTextAction(action, selectionText);
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action, selectionText }, () => {
                if (chrome.runtime.lastError) {
                    tryInjectAndRetry(tab, action, selectionText).catch(logError);
                }
            });
        } catch (err) {
            logError(err);
        }
    })();
});

function logError(err) {
    console.error("[GrammarFlow]", err);
}

async function tryInjectAndRetry(tab, action, selectionText) {
    let text = (selectionText || "").trim();

    if (text.length < MIN_SELECTION_CHARS) {
        text = await resolveSelectionText(tab, text);
    }

    if (isPdfViewerUrl(tab.url)) {
        await processTextAction(action, text);
        return;
    }

    try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await new Promise(r => setTimeout(r, 150));

        chrome.tabs.sendMessage(tab.id, { action, selectionText: text }, () => {
            if (chrome.runtime.lastError) {
                processTextAction(action, text).catch(logError);
            }
        });
    } catch (err) {
        logError(err);
        await processTextAction(action, text);
    }
}

// ─────────────────────────────────────────────
// MESSAGE HANDLER (from content.js and popup.js)
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "API_CALL") {
        handleApiCall(request.endpoint, request.payload, request.promptOverride, request.triggerAction)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: { message: err.message } }));
        return true;
    }

    if (request.action === "OPEN_TAB") {
        chrome.tabs.create({ url: request.url });
        sendResponse({ done: true });
        return true;
    }

    if (request.action === "FALLBACK_ACTION") {
        const tabId = request.tabId;
        const triggerAction = request.triggerAction;

        chrome.tabs.get(tabId, (tab) => {
            resolveSelectionText(tab, "").then((text) => {
                processTextAction(triggerAction, text).catch(logError);
            }).catch(logError);
        });
        sendResponse({ done: true });
        return true;
    }

    if (request.action === "RESOLVE_SELECTION") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            resolveSelectionText(tab, "")
                .then((text) => sendResponse({ text }))
                .catch(() => sendResponse({ text: "" }));
        });
        return true;
    }

    if (request.action === "NO_SELECTION") {
        processTextAction(request.triggerAction, "").catch(logError);
        sendResponse({ done: true });
        return true;
    }
});

// ─────────────────────────────────────────────
// API CALL HANDLER
// ─────────────────────────────────────────────
function getPromptForAction(endpoint, triggerAction, lang, style, tone, humanize) {
    if (endpoint === "/rewrite") return getRewritePrompt(style, tone, lang, humanize);
    if (triggerAction === "TRIGGER_GRAMMAR") return getGrammarFixPrompt(lang, humanize);
    if (triggerAction === "TRIGGER_SUMMARIZE") return getSummarizePrompt(lang);
    if (triggerAction === "TRIGGER_EXPLAIN") return getExplainPrompt(lang);
    return getGrammarFixPrompt(lang, humanize);
}

async function getOrCreateGuestSessionId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["guest_session_id"], (result) => {
            if (result.guest_session_id) {
                resolve(result.guest_session_id);
            } else {
                const uuid = self.crypto?.randomUUID ? self.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
                chrome.storage.local.set({ guest_session_id: uuid }, () => {
                    resolve(uuid);
                });
            }
        });
    });
}

// Get the auth token from storage (set when user signs in on the web app)
async function getAuthToken() {
    return new Promise((resolve) => {
        // The web app stores the token in localStorage which isn't accessible to extensions.
        // We use chrome.storage.local as the bridge — the web app should sync the token here.
        chrome.storage.local.get(["gf_token"], (result) => {
            resolve(result.gf_token || null);
        });
    });
}

async function handleApiCall(endpoint, payload, promptOverride = null, triggerAction = null) {
    const guestSessionId = await getOrCreateGuestSessionId();
    const prefs = await chrome.storage.sync.get({
        language: "Auto",
        style: "Casual",
        tone: "Friendly",
        humanize: true
    });

    const lang = prefs.language;
    const style = prefs.style;
    const tone = prefs.tone;
    const humanize = prefs.humanize;

    const systemPrompt = promptOverride || getPromptForAction(endpoint, triggerAction, lang, style, tone, humanize);

    const body = {
        ...payload,
        language: lang,
        style,
        tone,
        humanize,
        _extensionPrompt: systemPrompt
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const keepAliveTimer = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);

    // Build request headers — include auth token if user is signed in
    const authToken = await getAuthToken();
    const requestHeaders = { 
        "Content-Type": "application/json",
        "x-guest-session-id": guestSessionId
    };
    if (authToken) {
        requestHeaders["Authorization"] = `Bearer ${authToken}`;
    }

    let response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error("Request timed out. The server may be waking up — please try again.");
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
        clearInterval(keepAliveTimer);
    }

    let json;
    try {
        json = await response.json();
    } catch {
        throw new Error(`Server error (${response.status}). Please try again.`);
    }

    if (!response.ok) {
        const msg = (json && json.error && json.error.message) || ("API returned " + response.status);
        throw new Error(msg);
    }

    return json;
}
