/**
 * GrammarFlow — Multilingual Writing Intelligence
 * Phase 4: Smart Suggestions Engine + Context-Aware Intelligence
 */

const CONFIG = {
    PRODUCTION_API_URL: "https://grammarflow-brain.onrender.com",
    API_VERSION: "/api/v1",
};

const getBaseUrl = () => {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === "file:";
    if (CONFIG.PRODUCTION_API_URL && !isLocal) return CONFIG.PRODUCTION_API_URL + CONFIG.API_VERSION;
    return isLocal ? `http://localhost:3000${CONFIG.API_VERSION}` : CONFIG.API_VERSION;
};

const getOrCreateGuestSessionId = () => {
    let sessionId = localStorage.getItem("guest_session_id");
    if (!sessionId) {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            sessionId = crypto.randomUUID();
        } else {
            sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        localStorage.setItem("guest_session_id", sessionId);
    }
    return sessionId;
};

const GrammarFlowAPI = {
    async request(endpoint, payload, method = "POST") {
        const headers = {
            "x-guest-session-id": getOrCreateGuestSessionId(),
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        };
        let token = localStorage.getItem("gf_token");

        // If Clerk is loaded but the user has signed out, NEVER send a stale token.
        // This prevents history from leaking after logout due to residual gf_token in localStorage.
        const clerkLoaded = !!(window.Clerk && window.Clerk.user !== undefined);
        if (clerkLoaded && !window.Clerk.user) {
            // Clerk is active but user is signed out — forcefully clear any stale token
            if (token) {
                localStorage.removeItem("gf_token");
                console.log("[API] Clerk signed out — removed stale gf_token from localStorage");
            }
            token = null;
        } else if (window.Clerk && window.Clerk.user && window.Clerk.session) {
            try {
                const clerkToken = await window.Clerk.session.getToken();
                if (clerkToken) {
                    token = clerkToken;
                    localStorage.setItem("gf_token", token);
                }
            } catch (err) {
                console.warn("[API] Failed to retrieve dynamic Clerk token:", err.message);
            }
        }
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        const options = {
            method,
            headers
        };
        if (method !== "GET" && method !== "HEAD" && payload !== undefined) {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(payload);
        }
        
        let url = `${getBaseUrl()}${endpoint}`;
        if (method === "GET") {
            const separator = url.includes("?") ? "&" : "?";
            url += `${separator}_=${Date.now()}`;
        }
        
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error?.message || "Server error");
        return data;
    }
};

// ─────────────────────────────────────────────
// MOMENTUM ENGINE — Adaptive debounce (Phase 3, unchanged)
// ─────────────────────────────────────────────
class MomentumEngine {
    constructor() {
        this.lastKeystroke = Date.now();
        this.emaDelta = 400;
        this.alpha = 0.2;
    }
    recordStroke() {
        const now = Date.now();
        const delta = now - this.lastKeystroke;
        this.lastKeystroke = now;
        if (delta > 0 && delta < 5000) {
            this.emaDelta = (this.alpha * delta) + ((1 - this.alpha) * this.emaDelta);
        }
    }
    getDebounce() {
        if (this.emaDelta < 300) return 3000;
        if (this.emaDelta < 700) return 1500;
        return 900;
    }
}

// ─────────────────────────────────────────────
// SHADOW HIGHLIGHTER — Visual underlines (Phase 3, unchanged)
// ─────────────────────────────────────────────
class ShadowHighlighter {
    constructor(textarea, overlay) {
        this.textarea = textarea;
        this.overlay = overlay;
        this.highlights = [];
        this.syncStyles();
        this.textarea.addEventListener('scroll', () => this.syncScroll());
        window.addEventListener('resize', () => this.syncStyles());
    }
    syncStyles() {
        const s = window.getComputedStyle(this.textarea);
        Object.assign(this.overlay.style, {
            padding: s.padding,
            fontSize: s.fontSize,
            lineHeight: s.lineHeight,
            fontFamily: s.fontFamily,
        });
        this.render();
    }
    syncScroll() {
        this.overlay.scrollTop = this.textarea.scrollTop;
    }
    setHighlights(highlights) {
        this.highlights = highlights || [];
        this.render();
    }
    render() {
        const content = this.textarea.value;
        if (!content || !this.highlights.length) { this.overlay.innerHTML = ""; return; }
        let html = content.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        const sorted = [...this.highlights]
            .filter(h => h.original && html.includes(h.original))
            .sort((a, b) => html.lastIndexOf(b.original) - html.lastIndexOf(a.original));
        sorted.forEach(h => {
            const type = (h.category || 'grammar').toLowerCase();
            const esc = h.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(esc, 'g'), `<mark class="highlight-${type}">$&</mark>`);
        });
        this.overlay.innerHTML = html;
    }
}

// ─────────────────────────────────────────────
// CONTEXT ANALYZER — Phase 4: Lightweight client-side intelligence
// Runs synchronously, zero API cost, produces signals for /analyze-smart
// ─────────────────────────────────────────────
class ContextAnalyzer {
    analyze(text) {
        if (!text || text.length < 10) return {};
        const sentences = this._splitSentences(text);
        return {
            intent:            this._detectIntent(text),
            sentenceCount:     sentences.length,
            avgSentenceLength: this._avgLength(sentences),
            hasRepetition:     this._detectRepetition(text),
            toneShift:         this._detectToneShift(sentences),
            paragraphCount:    (text.match(/\n\n/g) || []).length + 1,
            wordCount:         text.split(/\s+/).filter(Boolean).length,
        };
    }

    _splitSentences(text) {
        return text.split(/[.!?।]/).map(s => s.trim()).filter(s => s.length > 3);
    }

    _avgLength(sentences) {
        if (!sentences.length) return 0;
        const total = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0);
        return Math.round(total / sentences.length);
    }

    _detectIntent(text) {
        const t = text.toLowerCase();
        // Indian casual markers — Hinglish + Telugu-English + Kannada-English
        const casualSignals = [
            // Hinglish
            'yaar', 'bhai', 'bro', 'man', 'lol', 'haha', 'arre', 'accha', 'theek', 'chill',
            // Telugu casual
            'ra', 'raa', 'anna', 'akka', 'naaku', 'nenu', 'chaala', 'konchem', 'manchi', 'undi', 'ante',
            // Kannada casual
            'ri', 'ree', 'kano', 'nanu', 'namma', 'swalpa', 'tumba', 'chennagi', 'bega', 'ide'
        ];
        const formalSignals = ['however', 'therefore', 'accordingly', 'furthermore', 'whereas', 'thus', 'hence', 'pursuant'];
        const emotionalSignals = [
            'feel', 'felt', 'hurt', 'love', 'miss', 'happy', 'sad', 'anxious', 'scared', 'proud', 'grateful',
            'kastanga', 'manchidi', 'kastam', 'kashta', 'chennagide'
        ];

        const score = (list) => list.filter(w => t.includes(w)).length;
        const c = score(casualSignals), f = score(formalSignals), e = score(emotionalSignals);

        if (e >= 2 && e >= c && e >= f) return 'emotional';
        if (f >= 2 && f > c) return 'professional';
        if (c >= 1) return 'casual';
        return 'neutral';
    }

    _detectRepetition(text) {
        const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 4);
        const freq = {};
        words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
        // A word used 3+ times in a paragraph is repetitive
        return Object.values(freq).some(count => count >= 3);
    }

    _detectToneShift(sentences) {
        if (sentences.length < 4) return false;
        const mid = Math.floor(sentences.length / 2);
        const first = sentences.slice(0, mid).join(' ').toLowerCase();
        const second = sentences.slice(mid).join(' ').toLowerCase();
        const formalWords = ['however', 'therefore', 'thus', 'hence', 'nevertheless'];
        const firstFormal = formalWords.some(w => first.includes(w));
        const secondFormal = formalWords.some(w => second.includes(w));
        // A shift from casual to formal or vice versa
        return firstFormal !== secondFormal;
    }
}

// ─────────────────────────────────────────────
// CONTEXT EXTRACTOR — always sends full text
// ─────────────────────────────────────────────
const getAnalysisContext = (text) => text.trim();

// ─────────────────────────────────────────────
// NORMALIZE FOR ANALYSIS
// Used ONLY for cache keys and duplicate detection.
// Original text is always sent to the backend unchanged.
//
// Treats these as identical:
//   "Hello world" == "Hello world." == "Hello world!" ==
//   "Hello world?" == "Hello world..." == "  Hello   world.  "
// ─────────────────────────────────────────────
const normalizeForAnalysis = (text) =>
    text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')           // collapse multiple spaces
        .replace(/[.!?]{1,}$/g, '')     // strip trailing . ! ? ...
        .replace(/^["'`]|["'`]$/g, '') // strip surrounding quotes
        .trim();

// ─────────────────────────────────────────────
// APP BOOTSTRAP
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const UI = {
        inputText:          document.getElementById("inputText"),
        highlighterOverlay: document.getElementById("highlighterOverlay"),
        styleSelect:        document.getElementById("styleSelect"),
        toneSelect:         document.getElementById("toneSelect"),
        languageSelect:     document.getElementById("languageSelect"),
        humanizeToggle:     document.getElementById("humanizeToggle"),
        rewriteBtn:         document.getElementById("rewriteBtn"),
        fixGrammarBtn:      document.getElementById("fixGrammarBtn"),
        outputSection:      document.getElementById("outputSection"),
        loadingIndicator:   document.getElementById("loadingIndicator"),
        resultsList:        document.getElementById("resultsList"),
        assistantBar:       document.getElementById("assistantBar"),
        suggestionText:     document.getElementById("suggestionText"),
        suggestionLabel:    document.getElementById("suggestionLabel"),
        suggestionCounter:  document.getElementById("suggestionCounter"),
        applyBtn:           document.getElementById("applySuggestionBtn"),
        prevBtn:            document.getElementById("prevSuggestionBtn"),
        nextBtn:            document.getElementById("nextSuggestionBtn"),
        closeAssistantBtn:   document.getElementById("closeAssistantBtn"),
        appLogo:            document.getElementById("appLogo"),
        // Document UI
        tabText:            document.getElementById("tabText"),
        tabDocument:        document.getElementById("tabDocument"),
        textModeContainer:  document.getElementById("textModeContainer"),
        documentModeContainer: document.getElementById("documentModeContainer"),
        textActionButtons:  document.getElementById("textActionButtons"),
        globalControls:     document.getElementById("globalControls"),
        documentUploadZone: document.getElementById("documentUploadZone"),
        fileInput:          document.getElementById("fileInput"),
        filePreviewContainer: document.getElementById("filePreviewContainer"),
        documentModeSelect: document.getElementById("documentModeSelect"),
        processDocumentBtn: document.getElementById("processDocumentBtn")
    };

    const momentum        = new MomentumEngine();
    const highlighter     = new ShadowHighlighter(UI.inputText, UI.highlighterOverlay);
    const contextAnalyzer = new ContextAnalyzer();

    let assistantTimer    = null;
    let lastRequestId     = 0;
    let lastAnalyzedKey   = '';   // normalized cache key — prevents re-firing on punctuation-only changes
    let allSuggestions    = [];
    let currentSugIdx     = 0;

    // ─── DISPLAY SUGGESTION ───────────────────
    const showSuggestion = (idx) => {
        if (!allSuggestions.length) return;
        currentSugIdx = Math.max(0, Math.min(idx, allSuggestions.length - 1));
        const sug = allSuggestions[currentSugIdx];

        UI.suggestionLabel.innerText = (sug.category || 'SUGGESTION').toUpperCase();
        UI.suggestionText.innerHTML  = `Consider: "<b>${sug.suggestion}</b>" <span style="opacity:0.55;font-size:0.8rem">(${sug.reason || ''})</span>`;

        if (allSuggestions.length > 1) {
            UI.suggestionCounter.textContent    = `${currentSugIdx + 1} of ${allSuggestions.length}`;
            UI.suggestionCounter.style.display  = 'inline-block';
        } else {
            UI.suggestionCounter.style.display = 'none';
        }

        UI.prevBtn.disabled = currentSugIdx === 0;
        UI.nextBtn.disabled = currentSugIdx === allSuggestions.length - 1;

        highlighter.setHighlights([sug]);
        UI.assistantBar.classList.add("visible");
        UI.appLogo.classList.add("notifying");
    };

    const hideAssistant = () => {
        UI.assistantBar.classList.remove("visible");
        UI.appLogo.classList.remove("notifying");
        highlighter.setHighlights([]);
        allSuggestions  = [];
        currentSugIdx   = 0;
        lastAnalyzedKey = '';  // Reset so next input always re-analyzes
    };

    // ─── NAV & DISMISS BUTTONS ─────────────────
    UI.prevBtn.onclick = () => showSuggestion(currentSugIdx - 1);
    UI.nextBtn.onclick = () => showSuggestion(currentSugIdx + 1);
    UI.closeAssistantBtn.onclick = () => hideAssistant();

    UI.applyBtn.onclick = () => {
        const sug = allSuggestions[currentSugIdx];
        if (!sug) return;
        UI.inputText.value = UI.inputText.value.replace(sug.original, sug.suggestion);
        allSuggestions.splice(currentSugIdx, 1);
        if (!allSuggestions.length) {
            hideAssistant();
        } else {
            showSuggestion(Math.min(currentSugIdx, allSuggestions.length - 1));
        }
        highlighter.render();
    };

    const setBusy = (busy) => {
        UI.rewriteBtn.disabled  = busy;
        UI.fixGrammarBtn.disabled = busy;
        
        const tab = (window.documentProcessor && window.documentProcessor.currentTab) || 'text';
        const loadingIndicator = tab === 'text' ? document.getElementById("loadingIndicator") : document.getElementById("docLoadingIndicator");
        const outputSection = tab === 'text' ? document.getElementById("outputSection") : document.getElementById("docOutputSection");
        const resultsList = tab === 'text' ? document.getElementById("resultsList") : document.getElementById("docResultsList");

        if (busy) {
            if (loadingIndicator) loadingIndicator.classList.remove("hidden");
            if (outputSection) outputSection.classList.remove("hidden");
            if (resultsList) resultsList.innerHTML = "";
        } else {
            if (loadingIndicator) loadingIndicator.classList.add("hidden");
        }
    };

    const renderResults = (results) => {
        const tab = (window.documentProcessor && window.documentProcessor.currentTab) || 'text';
        const resultsList = tab === 'text' ? document.getElementById("resultsList") : document.getElementById("docResultsList");
        if (!resultsList) return;

        resultsList.innerHTML = "";
        const data = Array.isArray(results) ? results : [results];
        data.forEach(text => {
            const card = document.createElement("div");
            card.className = "result-card";
            
            if (text && text.includes("===GF_SEPARATOR===")) {
                const parts = text.split("===GF_SEPARATOR===");
                const correctedText = parts[0].trim();
                const detailedMarkdown = parts[1].trim();

                const formattedDetailed = window.marked ? marked.parse(detailedMarkdown) : detailedMarkdown.replace(/\n/g, '<br>');

                // Unique ID for this tab instance to avoid ID collisions in multiple cards
                const tabId = "tab_" + Math.random().toString(36).substring(2, 9);

                card.innerHTML = `
                    <!-- Tab Headers -->
                    <div class="flex border-b border-white/10 mb-4 pb-2 gap-4">
                        <button class="tab-header-${tabId} text-sm font-bold text-purple-400 border-b-2 border-purple-500 pb-1 focus:outline-none cursor-pointer" data-tab="corrected">Corrected Text</button>
                        <button class="tab-header-${tabId} text-sm font-bold text-gray-400 hover:text-gray-200 pb-1 focus:outline-none cursor-pointer" data-tab="detailed">Detailed Analysis</button>
                    </div>

                    <!-- Tab Contents -->
                    <div class="tab-content-${tabId}" id="${tabId}_corrected">
                        <div class="result-text text-gray-200 text-sm md:text-base leading-relaxed select-all" style="white-space: pre-wrap;">${correctedText}</div>
                        <button class="copy-btn-mini" onclick="navigator.clipboard.writeText(document.getElementById('${tabId}_corrected').querySelector('.result-text').innerText || document.getElementById('${tabId}_corrected').querySelector('.result-text').textContent)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>

                    <div class="tab-content-${tabId} hidden" id="${tabId}_detailed">
                        <div class="result-text prose prose-invert max-w-none text-gray-300 text-sm space-y-3">${formattedDetailed}</div>
                        <button class="copy-btn-mini" onclick="navigator.clipboard.writeText(document.getElementById('${tabId}_detailed').querySelector('.result-text').innerText || document.getElementById('${tabId}_detailed').querySelector('.result-text').textContent)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                `;

                // Wire up tab switching
                setTimeout(() => {
                    const headers = card.querySelectorAll(`.tab-header-${tabId}`);
                    headers.forEach(h => {
                        h.onclick = () => {
                            // Active styling
                            headers.forEach(header => {
                                header.classList.remove('text-purple-400', 'border-b-2', 'border-purple-500');
                                header.classList.add('text-gray-400');
                            });
                            h.classList.add('text-purple-400', 'border-b-2', 'border-purple-500');
                            h.classList.remove('text-gray-400');

                            // Content visibility
                            const target = h.dataset.tab;
                            card.querySelectorAll(`.tab-content-${tabId}`).forEach(c => c.classList.add('hidden'));
                            card.querySelector(`#${tabId}_${target}`).classList.remove('hidden');
                        };
                    });
                }, 50);

            } else {
                // Format Markdown
                let formattedHtml = text;
                if (window.marked) {
                    marked.setOptions({ breaks: true, gfm: true });
                    formattedHtml = marked.parse(text);
                } else {
                    formattedHtml = text.replace(/\n/g, '<br>');
                }

                card.innerHTML = `
                    <div class="result-text prose prose-invert max-w-none text-gray-200 text-sm md:text-base space-y-4">
                        ${formattedHtml}
                    </div>
                    <button class="copy-btn-mini" onclick="navigator.clipboard.writeText(this.previousElementSibling.innerText || this.previousElementSibling.textContent)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>`;
            }
            resultsList.appendChild(card);
        });
    };



    // ─── REAL-TIME LOOP (Phase 3 + Phase 4) ──
    UI.inputText.addEventListener("keydown", () => momentum.recordStroke());
    UI.inputText.addEventListener("input", () => {
        highlighter.render();
        clearTimeout(assistantTimer);

        const rawText = UI.inputText.value;
        const text = rawText.trim();
        if (text.length < 5) { lastAnalyzedKey = ''; hideAssistant(); return; }


        const debounce  = momentum.getDebounce();
        const requestId = ++lastRequestId;
        UI.appLogo.classList.add("notifying");

        assistantTimer = setTimeout(async () => {
            const context    = getAnalysisContext(rawText);
            const normalKey  = normalizeForAnalysis(context);

            if (context.length < 5 || normalKey.length < 3) {
                UI.appLogo.classList.remove("notifying");
                return;
            }

            // Skip if the meaningful content hasn't changed
            // (e.g. user only added/changed trailing punctuation or whitespace)
            if (normalKey === lastAnalyzedKey) {
                UI.appLogo.classList.remove("notifying");
                return;
            }

            // Phase 4: paragraph mode for long text, sentence mode for short
            const isLongText = context.length >= 200;
            const endpoint   = isLongText ? '/analyze-smart' : '/analyze-realtime';

            // Build context signals (Phase 4, only for smart mode)
            const writingContext = isLongText ? contextAnalyzer.analyze(context) : undefined;

            try {
                console.log(`[GF] ${isLongText ? 'Smart' : 'Realtime'} → "${context.substring(0, 50)}..."`);
                if (isLongText) console.log('[GF] Context signals:', writingContext);

                const payload = {
                    text: context,
                    language: UI.languageSelect.value,
                    humanize: UI.humanizeToggle.checked,
                    ...(writingContext && { writingContext })
                };

                const res = await GrammarFlowAPI.request(endpoint, payload);
                if (requestId !== lastRequestId) return; // Stale response — discard

                UI.appLogo.classList.remove("notifying");

                if (res.success && res.data && res.data.length > 0) {
                    // Show all suggestions with meaningful confidence (lowered threshold for reliability)
                    const valid = res.data.filter(s => (s.confidence || 1) >= 0.15);
                    if (!valid.length) { hideAssistant(); return; }
                    lastAnalyzedKey = normalKey;  // ✅ Mark this content as analyzed
                    allSuggestions = valid;
                    showSuggestion(0);
                } else {
                    hideAssistant();
                }
            } catch (e) {
                console.error("[GF] Analysis failed:", e.message);
                UI.appLogo.classList.remove("notifying");
            }
        }, debounce);
    });

    // ─── MANUAL ACTIONS ───────────────────────
    const pollJobStatus = async (jobId) => {
        const maxAttempts = 40; // 60 seconds timeout
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const response = await fetch(`${getBaseUrl()}/job/${jobId}`);
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error?.message || "Job status check failed");
            }
            if (data.data.status === "completed") {
                return data.data.result;
            }
            if (data.data.status === "failed") {
                throw new Error(data.error?.message || "AI job failed to execute");
            }
        }
        throw new Error("Job timed out. Please try again.");
    };

    const processLargeText = async (text, actionType) => {
        const rawLines = text.split("\n");
        const lines = rawLines.map(line => line.trim()).filter(Boolean);
        
        // Group into chunks of 15 lines/sentences
        const chunkSize = 15;
        const chunks = [];
        for (let i = 0; i < lines.length; i += chunkSize) {
            chunks.push(lines.slice(i, i + chunkSize).join("\n"));
        }

        console.log(`[Chunker] Processing ${lines.length} lines in ${chunks.length} chunks of size ${chunkSize}...`);
        
        let mergedCorrected = [];
        let mergedAnalysis = [];
        let mergedRewrites = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            
            // Show progressive progress
            renderResults([`Processing part ${i + 1} of ${chunks.length}...`]);

            if (actionType === "grammar-fix") {
                const res = await GrammarFlowAPI.request("/grammar-fix", {
                    text: chunkText,
                    language: UI.languageSelect.value,
                    style: UI.styleSelect.value,
                    tone: UI.toneSelect.value,
                    humanize: UI.humanizeToggle.checked,
                    learningMode: false
                });
                
                let chunkResult = "";
                if (res.data && res.data.status === "queued" && res.data.jobId) {
                    chunkResult = await pollJobStatus(res.data.jobId);
                } else {
                    chunkResult = res.data;
                }

                if (chunkResult && chunkResult.includes("===GF_SEPARATOR===")) {
                    const parts = chunkResult.split("===GF_SEPARATOR===");
                    mergedCorrected.push(parts[0].trim());
                    mergedAnalysis.push(parts[1].trim());
                } else {
                    mergedCorrected.push(chunkResult.trim());
                }
            } else if (actionType === "rewrite") {
                const res = await GrammarFlowAPI.request("/rewrite", {
                    text: chunkText,
                    style: UI.styleSelect.value,
                    tone: UI.toneSelect.value,
                    language: UI.languageSelect.value,
                    humanize: UI.humanizeToggle.checked
                });
                
                const option = (Array.isArray(res.data) ? res.data[0] : res.data) || "";
                mergedRewrites.push(option.trim());
            }

            // Wait 1.5s between chunks to keep Groq API stable and avoid 429 Rate Limits
            if (i < chunks.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        if (actionType === "grammar-fix") {
            const finalCorrected = mergedCorrected.join("\n\n");
            const finalAnalysis = mergedAnalysis.join("\n\n---\n\n");
            return `${finalCorrected}\n\n===GF_SEPARATOR===\n\n${finalAnalysis}`;
        } else {
            return [mergedRewrites.join("\n\n")];
        }
    };

    UI.rewriteBtn.onclick = async () => {
        const text = UI.inputText.value.trim();
        if (!text) return;
        setBusy(true);
        try {
            const linesCount = text.split("\n").map(l => l.trim()).filter(Boolean).length;
            if (linesCount > 15) {
                const results = await processLargeText(text, "rewrite");
                renderResults(results);
            } else {
                const res = await GrammarFlowAPI.request("/rewrite", {
                    text, style: UI.styleSelect.value, tone: UI.toneSelect.value,
                    language: UI.languageSelect.value, humanize: UI.humanizeToggle.checked
                });
                renderResults(res.data);
            }
        } catch (e) { renderResults([`Error: ${e.message}`]); }
        finally { setBusy(false); }
    };

    UI.fixGrammarBtn.onclick = async () => {
        const text = UI.inputText.value.trim();
        if (!text) return;
        setBusy(true);
        try {
            const linesCount = text.split("\n").map(l => l.trim()).filter(Boolean).length;
            if (linesCount > 15) {
                const result = await processLargeText(text, "grammar-fix");
                renderResults([result]);
            } else {
                const res = await GrammarFlowAPI.request("/grammar-fix", {
                    text,
                    language: UI.languageSelect.value,
                    style: UI.styleSelect.value,
                    tone: UI.toneSelect.value,
                    humanize: UI.humanizeToggle.checked,
                    learningMode: false
                });
                if (res.data && res.data.status === "queued" && res.data.jobId) {
                    const result = await pollJobStatus(res.data.jobId);
                    renderResults([result]);
                } else {
                    renderResults(res.data);
                }
            }
        } catch (e) { renderResults([`Error: ${e.message}`]); }
        finally { setBusy(false); }
    };

    // ─── DOCUMENT PROCESSOR ───────────────────────
    class DocumentProcessor {
        constructor() {
            this.files = [];
            this.extractedText = "";
            this.currentTab = 'text';
            this.initWorker();
            this.bindEvents();
        }

        initWorker() {
            if (window.pdfjsLib) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            }
        }

        bindEvents() {
            // Tabs
            UI.tabText.onclick = () => this.switchTab('text');
            UI.tabDocument.onclick = () => this.switchTab('document');

            // Upload Zone
            UI.documentUploadZone.onclick = () => UI.fileInput.click();
            UI.documentUploadZone.ondragover = (e) => { e.preventDefault(); UI.documentUploadZone.classList.add('dragover'); };
            UI.documentUploadZone.ondragleave = () => UI.documentUploadZone.classList.remove('dragover');
            UI.documentUploadZone.ondrop = (e) => {
                e.preventDefault();
                UI.documentUploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length) this.handleFiles(e.dataTransfer.files);
            };
            UI.fileInput.onchange = (e) => this.handleFiles(e.target.files);

            // Process Button
            UI.processDocumentBtn.onclick = () => this.processDocument();
        }

        switchTab(tab) {
            this.currentTab = tab;
            if (tab === 'text') {
                UI.tabText.classList.add('active');
                UI.tabDocument.classList.remove('active');
                UI.textModeContainer.classList.remove('hidden');
                UI.textActionButtons.classList.remove('hidden');
                UI.documentModeContainer.classList.add('hidden');
                
                // Rebuild language options for Text Editor (includes Kannada/Telugu)
                this.updateLanguageOptions(['Auto', 'English', 'Hindi', 'Hinglish', 'Kannada', 'Telugu']);
            } else {
                UI.tabDocument.classList.add('active');
                UI.tabText.classList.remove('active');
                UI.documentModeContainer.classList.remove('hidden');
                UI.textActionButtons.classList.add('hidden');
                UI.textModeContainer.classList.add('hidden');

                // Rebuild language options for Document AI (Hides Kannada/Telugu)
                this.updateLanguageOptions(['Auto', 'English', 'Hindi', 'Hinglish']);
                // Apply OCR mode state for current selection
                this.updateOCRMode();
            }
        }

        updateLanguageOptions(langs) {
            const currentVal = UI.languageSelect.value;
            UI.languageSelect.innerHTML = '';
            langs.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l;
                opt.textContent = l === 'Auto' ? 'Auto-Detect' : l;
                UI.languageSelect.appendChild(opt);
            });
            
            // Restore previous value if it's still available, else default to English
            if (langs.includes(currentVal)) {
                UI.languageSelect.value = currentVal;
            } else {
                UI.languageSelect.value = 'English';
            }
        }

        updateOCRMode() {
            const modeEl    = document.getElementById('documentModeSelect');
            const controls  = document.getElementById('globalControls');
            const banner    = document.getElementById('ocrModeBanner');
            const isOCR     = modeEl && modeEl.value === 'Grammar';

            if (isOCR) {
                if (controls) controls.style.display = 'none';
                if (banner)   { banner.style.display = 'flex'; }
            } else {
                if (controls) controls.style.display = '';
                if (banner)   { banner.style.display = 'none'; }
            }
        }

        handleFiles(fileList) {
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                if (file.type === "application/pdf" || file.type.startsWith("image/")) {
                    this.files.push(file);
                }
            }
            this.renderFilePreviews();
            UI.processDocumentBtn.disabled = this.files.length === 0;
        }

        removeFile(index) {
            this.files.splice(index, 1);
            this.renderFilePreviews();
            UI.processDocumentBtn.disabled = this.files.length === 0;
        }

        renderFilePreviews() {
            UI.filePreviewContainer.innerHTML = '';
            if (this.files.length > 0) {
                UI.filePreviewContainer.classList.remove('hidden');
                this.files.forEach((file, idx) => {
                    const chip = document.createElement('div');
                    chip.className = 'flex items-center gap-2 bg-[#252545]/80 border border-white/10 rounded-full px-4 py-2 text-sm text-gray-200 hover:border-purple-500/40 hover:bg-[#2d2d55] transition-all shadow-[0_0_10px_rgba(168,85,247,0.05)] cursor-default';
                    chip.innerHTML = `
                        <svg class="w-4 h-4 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"></path></svg>
                        <span class="truncate max-w-[180px] font-medium">${file.name}</span> 
                        <span class="remove-file text-gray-400 hover:text-red-400 font-bold text-lg ml-2 cursor-pointer transition-colors leading-none" onclick="window.documentProcessor.removeFile(${idx})">×</span>
                    `;
                    UI.filePreviewContainer.appendChild(chip);
                });
            } else {
                UI.filePreviewContainer.classList.add('hidden');
            }
        }

        async extractPdfText(file) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str).join(' ') + "\\n";
            }
            return fullText;
        }

        async extractImageText(file) {
            const result = await Tesseract.recognize(file, 'eng');
            return result.data.text;
        }

        async extractAll() {
            let combinedText = "";
            for (const file of this.files) {
                if (file.type === "application/pdf") {
                    combinedText += await this.extractPdfText(file) + "\\n\\n";
                } else if (file.type.startsWith("image/")) {
                    combinedText += await this.extractImageText(file) + "\\n\\n";
                }
            }
            return combinedText.trim();
        }

        async extractAll() {
            let combinedText = "";
            for (const file of this.files) {
                if (file.type === "application/pdf") {
                    combinedText += await this.extractPdfText(file) + "\\n\\n";
                } else if (file.type.startsWith("image/")) {
                    combinedText += await this.extractImageText(file) + "\\n\\n";
                }
            }
            return combinedText.trim();
        }

        getLanguageWeight(lang) {
            const weights = {
                'English': 1.0,
                'Hinglish': 1.8,
                'Telugu': 2.5,
                'Kannada': 2.5,
                'Hindi': 2.2
            };
            return weights[lang] || 1.5;
        }

        chunkText(text, language = 'English') {
            const weight = this.getLanguageWeight(language);
            const baseMaxChars = 6000; // Increased to speed up processing
            const maxChars = Math.floor(baseMaxChars / weight);
            
            if (text.length <= maxChars) return [text];
            const chunks = [];
            let currentIdx = 0;
            
            while (currentIdx < text.length) {
                let endIdx = currentIdx + maxChars;
                if (endIdx >= text.length) {
                    chunks.push(text.substring(currentIdx));
                    break;
                }
                
                // Smart boundary detection: Try sections first, then paragraphs, then sentences
                let breakIdx = text.lastIndexOf("\\n# ", endIdx); // Markdown Heading
                if (breakIdx <= currentIdx) breakIdx = text.lastIndexOf("\\n\\n", endIdx); // Paragraph
                if (breakIdx <= currentIdx) breakIdx = text.lastIndexOf(". ", endIdx); // Sentence
                
                if (breakIdx <= currentIdx) {
                    breakIdx = endIdx; // Fallback
                } else {
                    breakIdx += 1;
                }
                
                chunks.push(text.substring(currentIdx, breakIdx).trim());
                currentIdx = breakIdx;
            }
            return chunks;
        }

        getCacheKey(file, mode, lang) {
            if (!file) return null;
            return `gf_doc_${file.name}_${file.size}_${mode}_${lang}`;
        }

        async processDocument() {
            if (this.files.length === 0) return;
            
            setBusy(true);
            this.isCanceled = false;
            document.getElementById("exportControls").classList.add("hidden");
            
            const tab = this.currentTab || 'document';
            const cancelBtn = tab === 'text' ? document.getElementById("cancelProcessBtn") : document.getElementById("docCancelProcessBtn");
            if (cancelBtn) {
                cancelBtn.classList.remove("hidden");
                cancelBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" ry="2" stroke-width="2"></rect></svg> Stop Process`;
                cancelBtn.onclick = () => { 
                    this.isCanceled = true; 
                    cancelBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="25"></circle></svg> Stopping...`; 
                };
            }

            const mainFile = this.files[0];
            const mode = UI.documentModeSelect.value;
            const isOCR = mode === 'Grammar';

            // OCR mode forces auto-language, no humanize, no tone
            const lang = isOCR ? 'Auto' : UI.languageSelect.value;
            const humanizeActive = isOCR ? false : UI.humanizeToggle.checked;

            const cacheKey = this.getCacheKey(mainFile, mode, lang);
            
            let intermediateResults = [];
            let startAt = 0;

            // Check Cache
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
                const data = JSON.parse(cachedData);
                const resume = await this.promptResume();
                if (resume) {
                    intermediateResults = data.results;
                    startAt = data.nextChunk;
                    renderResults(intermediateResults);
                }
            }

            try {
                if (startAt === 0) {
                    renderResults(["Extracting text from document(s)... locally."]);
                    this.extractedText = await this.extractAll();
                }

                if (!this.extractedText && startAt === 0) throw new Error("No text found.");
                
                const chunks = this.chunkText(this.extractedText, lang);
                
                for (let i = startAt; i < chunks.length; i++) {
                    if (this.isCanceled) throw new Error("Canceled by user.");
                    
                    renderResults([...intermediateResults, `Processing part ${i + 1} of ${chunks.length}...`]);
                    
                    const chunkResult = await this.requestWithRetry(chunks[i], mode, lang, false, humanizeActive);
                    intermediateResults.push(chunkResult);
                    
                    // Save to Cache
                    localStorage.setItem(cacheKey, JSON.stringify({ results: intermediateResults, nextChunk: i + 1 }));
                    
                    // Progressive Display
                    renderResults(intermediateResults);
                    
                    if (i < chunks.length - 1) {
                        renderResults([...intermediateResults, `Waiting 5s to maintain AI stability...`]);
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }

                if (this.isCanceled) throw new Error("Canceled by user.");

                // Final Pass
                let finalResult = "";
                if (chunks.length === 1) {
                    finalResult = intermediateResults[0];
                } else if (mode === "Summarize") {
                    renderResults([...intermediateResults, "Finalizing document structure and weaving summaries together... (Please wait)"]);
                    finalResult = await this.hierarchicalConsolidate(intermediateResults, mode, lang);
                } else {
                    finalResult = intermediateResults.join("\n\n");
                }

                renderResults([finalResult]);
                this.finalOutput = finalResult;
                document.getElementById("exportControls").classList.remove("hidden");
                localStorage.removeItem(cacheKey); // Clear cache on success

            } catch (e) {
                renderResults([...intermediateResults, `Error: ${e.message}`]);
            } finally {
                setBusy(false);
                if (cancelBtn) { 
                    cancelBtn.classList.add("hidden"); 
                    cancelBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" ry="2" stroke-width="2"></rect></svg> Stop Process`; 
                }
            }
        }

        async requestWithRetry(text, mode, lang, isConsolidation = false, humanize = null) {
            let retries = 0;
            // Use explicitly passed humanize value, else read from UI
            const humanizeVal = (humanize !== null) ? humanize : UI.humanizeToggle.checked;
            while (retries < 5) {
                try {
                    const res = await GrammarFlowAPI.request("/process-document", {
                        text, mode, language: lang,
                        style: UI.styleSelect.value, tone: UI.toneSelect.value,
                        humanize: humanizeVal, isConsolidation
                    });
                    return res.data[0];
                } catch (err) {
                    retries++;
                    if (this.isCanceled) throw new Error("Canceled.");
                    if (retries >= 5) throw err;
                    console.warn(`Rate limit hit. Waiting ${10 * retries}s before retry...`);
                    await new Promise(r => setTimeout(r, 10000 * retries)); // 10s, 20s, 30s... backoff
                }
            }
        }

        async hierarchicalConsolidate(results, mode, lang, depth = 0) {
            const combined = results.join("\n\n");
            
            // If it's short enough or we've recursed too much (max 2 levels), just do one last pass
            if (combined.length < 15000 || depth >= 2) {
                return await this.requestWithRetry(combined, mode, lang, true);
            }

            // Otherwise, chunk and recurse
            const newChunks = this.chunkText(combined, lang);
            const summarizedChunks = [];
            for (const chunk of newChunks) {
                summarizedChunks.push(await this.requestWithRetry(chunk, mode, lang, true));
            }
            return await this.hierarchicalConsolidate(summarizedChunks, mode, lang, depth + 1);
        }

        promptResume() {
            return new Promise((resolve) => {
                const prompt = document.getElementById("resumePrompt");
                prompt.classList.remove("hidden");
                document.getElementById("resumeYesBtn").onclick = () => { prompt.classList.add("hidden"); resolve(true); };
                document.getElementById("resumeNoBtn").onclick = () => { prompt.classList.add("hidden"); resolve(false); };
            });
        }

        exportToPDF() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const text = this.finalOutput || "No output to export.";
            const splitText = doc.splitTextToSize(text, 180);
            doc.text(splitText, 10, 10);
            doc.save("GrammarFlow_Result.pdf");
        }

        exportToDOCX() {
            const { Document, Packer, Paragraph, TextRun } = window.docx;
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [new Paragraph({ children: [new TextRun(this.finalOutput)] })],
                }],
            });
            Packer.toBlob(doc).then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "GrammarFlow_Result.docx";
                a.click();
            });
        }
    }

    // Initialize Global Processor
    window.documentProcessor = new DocumentProcessor();
    document.getElementById("downloadPdfBtn").onclick = () => window.documentProcessor.exportToPDF();
    document.getElementById("downloadDocxBtn").onclick = () => window.documentProcessor.exportToDOCX();
    
    // Wire documentModeSelect change to toggle OCR mode UI
    if (UI.documentModeSelect) {
        UI.documentModeSelect.addEventListener('change', () => window.documentProcessor.updateOCRMode());
    }

    // ─────────────────────────────────────────────
    // HISTORY & AUTHENTICATION WIRING
    // ─────────────────────────────────────────────
    const btnHistory = document.getElementById("btnHistory");
    const btnSettings = document.getElementById("btnSettings");
    const historyModal = document.getElementById("historyModal");
    const settingsModal = document.getElementById("settingsModal");
    const closeHistoryBtn = document.getElementById("closeHistoryBtn");
    const closeSettingsBtn = document.getElementById("closeSettingsBtn");

    // Helper: Esc text helper
    const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Modal Control: Open History
    if (btnHistory && historyModal) {
        btnHistory.onclick = () => {
            historyModal.classList.remove("hidden");
            loadHistory();
        };
    }

    // Modal Control: Open Settings
    if (btnSettings && settingsModal) {
        btnSettings.onclick = () => {
            settingsModal.classList.remove("hidden");
            clerkConfigFetched = false; // Reset config fetched flag to allow retry when opening settings
            restoreSyncSection();
        };
    }

    // Modal Control: Close History
    if (closeHistoryBtn && historyModal) {
        closeHistoryBtn.onclick = () => historyModal.classList.add("hidden");
    }

    // Modal Control: Close Settings
    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.onclick = () => settingsModal.classList.add("hidden");
    }

    // Close modals on clicking backdrop
    window.addEventListener("click", (e) => {
        if (e.target === historyModal) historyModal.classList.add("hidden");
        if (e.target === settingsModal) settingsModal.classList.add("hidden");
    });

    // Close modals on Esc keypress
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (historyModal) historyModal.classList.add("hidden");
            if (settingsModal) settingsModal.classList.add("hidden");
        }
    });

    // Clerk Integration State
    let clerkLoaded = false;
    let isClerkEnabled = false;
    let clerkCheckingConfig = false;
    let clerkConfigFetched = false;
    let clerkLoadFailed = false;

    const initClerk = async () => {
        if (clerkLoaded) return;
        if (clerkCheckingConfig) return;
        clerkCheckingConfig = true;
        clerkLoadFailed = false;
        try {
            console.log("[AUTH] Fetching Clerk configuration...");
            const configRes = await fetch(`${getBaseUrl()}/auth/config`);
            const config = await configRes.json();
            clerkConfigFetched = true;
            if (config.success && config.data && config.data.clerkPublishableKey) {
                const publishableKey = config.data.clerkPublishableKey;
                isClerkEnabled = true;
                console.log("[AUTH] Clerk config found. Loading Clerk JS...");
                
                await new Promise((resolve, reject) => {
                    const script = document.createElement("script");
                    script.setAttribute("data-clerk-publishable-key", publishableKey);
                    script.async = true;
                    script.src = "https://js.clerk.com/v1/clerk.browser.js";
                    script.crossOrigin = "anonymous";
                    script.onload = async () => {
                        try {
                            if (window.Clerk) {
                                await window.Clerk.load();
                                clerkLoaded = true;
                                console.log("[AUTH] Clerk JS loaded and initialized successfully.");
                                resolve();
                            } else {
                                reject(new Error("Clerk global not found after script load"));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    };
                    script.onerror = (err) => {
                        console.warn("[AUTH] Primary Clerk CDN failed to load. Trying @clerk/clerk-js@5 jsDelivr fallback...");
                        const fallbackScript = document.createElement("script");
                        fallbackScript.setAttribute("data-clerk-publishable-key", publishableKey);
                        fallbackScript.async = true;
                        fallbackScript.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
                        fallbackScript.crossOrigin = "anonymous";
                        fallbackScript.onload = async () => {
                            try {
                                if (window.Clerk) {
                                    await window.Clerk.load();
                                    clerkLoaded = true;
                                    console.log("[AUTH] Clerk JS loaded from jsDelivr successfully.");
                                    resolve();
                                } else {
                                    reject(new Error("Clerk global not found after jsDelivr script load"));
                                }
                            } catch (e) {
                                reject(e);
                            }
                        };
                        fallbackScript.onerror = (err2) => {
                            reject(new Error("Failed to load Clerk script from both primary and fallback CDNs."));
                        };
                        document.body.appendChild(fallbackScript);
                    };
                    document.body.appendChild(script);
                });

                // Add state listener to update UI when session changes
                let wasLoggedIn = !!(window.Clerk && window.Clerk.user);
                window.Clerk.addListener(async ({ session, user }) => {
                    console.log("[AUTH] Clerk auth state changed:", user ? user.primaryEmailAddress?.emailAddress : "No user");

                    if (!user && wasLoggedIn) {
                        // User just signed out — IMMEDIATELY clear all auth data BEFORE any async work
                        // This prevents race conditions where checkAuthState still sees the old user
                        console.log("[AUTH] Sign-out detected. Clearing all auth state immediately.");
                        localStorage.removeItem("gf_token");
                        localStorage.removeItem("gf_history_cache");
                        localStorage.removeItem("guest_session_id");
                        getOrCreateGuestSessionId(); // Generate a fresh guest session ID

                        // Clear history UI immediately without waiting for any async call
                        const container = document.getElementById("historyContent");
                        if (container) container.innerHTML = "";

                        wasLoggedIn = false;
                        // Update UI to guest mode, then show empty history if modal is open
                        await checkAuthState();
                        if (historyModal && !historyModal.classList.contains("hidden")) {
                            loadHistory();
                        }
                    } else if (user) {
                        wasLoggedIn = true;
                        // Clear history cache on login to refresh with new user's data
                        localStorage.removeItem("gf_history_cache");
                        const container = document.getElementById("historyContent");
                        if (container) container.innerHTML = "";

                        await checkAuthState();
                        const settingsModal = document.getElementById("settingsModal");
                        if (settingsModal && !settingsModal.classList.contains("hidden")) {
                            restoreSyncSection();
                        }
                        if (historyModal && !historyModal.classList.contains("hidden")) {
                            loadHistory();
                        }
                    }
                });

                await checkAuthState();
                const settingsModal = document.getElementById("settingsModal");
                if (settingsModal && !settingsModal.classList.contains("hidden")) {
                    restoreSyncSection();
                }
            } else {
                isClerkEnabled = false;
                console.log("[AUTH] Clerk Publishable Key not configured. Using mock auth fallback.");
            }
        } catch (err) {
            clerkLoadFailed = true;
            console.error("[AUTH] Failed to initialize Clerk:", err.message);
        } finally {
            clerkCheckingConfig = false;
            // Always refresh UI once config fetching completes (fails or succeeds) to clear load spinner
            const settingsModal = document.getElementById("settingsModal");
            if (settingsModal && !settingsModal.classList.contains("hidden")) {
                restoreSyncSection();
            }
        }
    };

    // Auth State Check
    const checkAuthState = async () => {
        let token = localStorage.getItem("gf_token");
        const profileSection = document.getElementById("profileSection");
        const userName = document.getElementById("userName");
        const userEmail = document.getElementById("userEmail");
        const syncStatusDot = document.getElementById("syncStatusDot");
        const syncText = document.getElementById("syncText");
        const signInBtn = document.getElementById("signInBtn");
        const signOutBtn = document.getElementById("signOutBtn");
        
        if (!syncText || !syncStatusDot || !signInBtn || !signOutBtn || !profileSection) return;

        // If Clerk is loaded and active, we override mock auth checks with Clerk state
        if (clerkLoaded && window.Clerk && window.Clerk.user) {
            try {
                const user = window.Clerk.user;
                token = await window.Clerk.session.getToken();
                if (token) {
                    localStorage.setItem("gf_token", token);
                }
                
                // Sync session with the backend so their user details and guest history are stored
                const res = await GrammarFlowAPI.request("/auth/sync", {
                    guestSessionId: getOrCreateGuestSessionId()
                }, "POST");

                if (res.success && res.data && res.data.user) {
                    const dbUser = res.data.user;
                    if (userName) userName.textContent = dbUser.name || user.fullName || user.username || 'Anonymous User';
                    if (userEmail) userEmail.textContent = dbUser.email || user.primaryEmailAddress?.emailAddress;
                    profileSection.classList.remove("hidden");
                    
                    // Connected green dot
                    syncStatusDot.className = "inline-block w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] shrink-0";
                    syncText.textContent = "Synced with your GrammarFlow account. Your writing drafts are backed up.";
                    
                    signInBtn.classList.add("hidden");
                    signOutBtn.classList.remove("hidden");
                    return;
                }
            } catch (err) {
                console.warn("[AUTH] Clerk sync session failed:", err.message);
                // Fallback to client-side Clerk state display even if backend sync temporarily fails/offline
                const user = window.Clerk.user;
                if (userName) userName.textContent = user.fullName || user.username || 'Anonymous User';
                if (userEmail) userEmail.textContent = user.primaryEmailAddress?.emailAddress;
                profileSection.classList.remove("hidden");
                
                // Offline yellow dot
                syncStatusDot.className = "inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)] animate-pulse shrink-0";
                syncText.textContent = "Offline. Local changes will sync when connection is restored.";
                
                signInBtn.classList.add("hidden");
                signOutBtn.classList.remove("hidden");
                return;
            }
        } else if (clerkLoaded && window.Clerk && !window.Clerk.user) {
            // Explicitly logged out from Clerk
            localStorage.removeItem("gf_token");
            localStorage.removeItem("gf_history_cache");
            token = null;
        }

        if (token) {
            try {
                const res = await GrammarFlowAPI.request("/auth/sync", {
                    guestSessionId: getOrCreateGuestSessionId()
                }, "POST");
                
                if (res.success && res.data && res.data.user) {
                    const user = res.data.user;
                    if (userName) userName.textContent = user.name || 'Anonymous User';
                    if (userEmail) userEmail.textContent = user.email;
                    profileSection.classList.remove("hidden");
                    
                    // Connected green dot
                    syncStatusDot.className = "inline-block w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)] shrink-0";
                    syncText.textContent = "Synced with your GrammarFlow account. Your writing drafts are backed up.";
                    
                    signInBtn.classList.add("hidden");
                    signOutBtn.classList.remove("hidden");
                    return;
                }
            } catch (err) {
                console.warn("[AUTH] Passive sync check failed/offline:", err.message);
                if (token.startsWith("mock_token_")) {
                    try {
                        const parts = token.split("_");
                        const email = parts[2] || "guest@grammarflow.com";
                        const name = parts[3] ? decodeURIComponent(parts[3]) : "Guest User";
                        if (userName) userName.textContent = name;
                        if (userEmail) userEmail.textContent = email;
                        profileSection.classList.remove("hidden");
                        
                        // Offline yellow dot
                        syncStatusDot.className = "inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)] animate-pulse shrink-0";
                        syncText.textContent = "Offline. Local changes will sync when connection is restored.";
                        
                        signInBtn.classList.add("hidden");
                        signOutBtn.classList.remove("hidden");
                        return;
                    } catch (e) {
                        console.error("[AUTH] Failed to decode offline mock token", e);
                    }
                }
            }
        }
        
        // Default Local/Guest Mode (purple dot)
        profileSection.classList.add("hidden");
        syncStatusDot.className = "inline-block w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse shrink-0";
        syncText.textContent = "Your writing is safely stored on this device. Sign in to sync it everywhere.";
        signInBtn.classList.remove("hidden");
        signOutBtn.classList.add("hidden");
    };

    const restoreSyncSection = () => {
        const syncText = document.getElementById("syncText");
        const authActions = document.getElementById("authActions");
        if (!syncText || !authActions) return;
        
        checkAuthState();
        
        // Try initializing Clerk in the background ONLY if we haven't fetched the config yet
        if (!clerkLoaded && !clerkCheckingConfig && !clerkConfigFetched) {
            initClerk().catch(e => console.warn("[AUTH] Settings retry of Clerk failed:", e));
        }

        if (clerkCheckingConfig && !clerkLoaded) {
            authActions.innerHTML = `
                <div class="flex items-center gap-2 text-xs text-gray-400 font-semibold px-1 py-2">
                    <svg class="animate-spin h-4 w-4 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting to authentication...
                </div>
            `;
            return;
        }
        
        if (clerkLoadFailed) {
            syncText.innerHTML = `
                <div class="text-xs text-red-400 leading-relaxed font-medium flex flex-col gap-1">
                    <span>⚠️ Authentication service (Clerk) failed to load.</span>
                    <span>This is usually caused by <strong>Brave Shield</strong>, <strong>uBlock Origin</strong>, or another adblocker blocking <code>cdn.clerk.com</code>.</span>
                    <span class="text-white font-bold mt-1">Please disable your adblocker/Shield for this site and refresh the page.</span>
                </div>
            `;
            authActions.innerHTML = `
                <button id="retryClerkBtn" class="text-xs font-bold px-4 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-all shadow-md cursor-pointer">Retry Connection</button>
            `;
            const retryClerkBtn = document.getElementById("retryClerkBtn");
            if (retryClerkBtn) {
                retryClerkBtn.onclick = () => {
                    clerkConfigFetched = false;
                    restoreSyncSection();
                };
            }
            return;
        }

        authActions.innerHTML = `
            <button id="signInBtn" class="text-xs font-bold px-4 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-all shadow-md cursor-pointer">Sign In</button>
            <button id="signOutBtn" class="hidden text-xs font-bold px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all cursor-pointer">Sign Out</button>
        `;
        
        const signInBtn = document.getElementById("signInBtn");
        const signOutBtn = document.getElementById("signOutBtn");
        
        if (signInBtn) {
            signInBtn.onclick = () => {
                if (isClerkEnabled) {
                    if (clerkLoaded && window.Clerk) {
                        window.Clerk.openSignIn();
                    } else {
                        alert("Clerk is still loading. Please wait a moment...");
                    }
                } else {
                    showLoginForm();
                }
            };
        }
        if (signOutBtn) {
            signOutBtn.onclick = () => {
                if (isClerkEnabled) {
                    if (clerkLoaded && window.Clerk) {
                        window.Clerk.signOut();
                    }
                } else {
                    performSignOut();
                }
            };
        }
        
        // Ensure state is updated correctly after innerHTML replace
        checkAuthState();
    };

    const showLoginForm = () => {
        const syncText = document.getElementById("syncText");
        const authActions = document.getElementById("authActions");
        if (!syncText || !authActions) return;

        let activeTab = "login"; // default tab is login

        syncText.innerHTML = `
            <div class="flex border-b border-white/10 mb-3 gap-2">
                <button id="tabLogIn" type="button" class="flex-1 pb-2 text-xs font-bold text-center border-b-2 border-purple-500 text-purple-400 focus:outline-none cursor-pointer transition-all">Log In</button>
                <button id="tabSignUp" type="button" class="flex-1 pb-2 text-xs font-bold text-center border-b-2 border-transparent text-gray-500 hover:text-gray-300 focus:outline-none cursor-pointer transition-all">Sign Up</button>
            </div>
            <div class="flex flex-col gap-2 mt-1">
                <input type="email" id="loginEmail" placeholder="Enter email (e.g. user@domain.com)" class="bg-[#120e26] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/40 w-full">
                <div id="loginNameContainer" class="hidden">
                    <input type="text" id="loginName" placeholder="Enter full name" class="bg-[#120e26] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/40 w-full">
                </div>
                <div class="relative w-full">
                    <input type="password" id="loginPassword" placeholder="Password (min 8 chars, A-z, special char)" class="bg-[#120e26] border border-white/10 rounded-xl pl-3 pr-10 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/40 w-full">
                    <button type="button" id="togglePasswordVisibilityBtn" class="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white cursor-pointer focus:outline-none">
                        <svg id="eyeIcon" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        authActions.innerHTML = `
            <button id="confirmLoginBtn" class="text-xs font-bold px-4 py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-all cursor-pointer">Confirm</button>
            <button id="cancelLoginBtn" class="text-xs font-bold px-4 py-2 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer">Cancel</button>
        `;
        
        document.getElementById("cancelLoginBtn").onclick = restoreSyncSection;
        
        const tabLogIn = document.getElementById("tabLogIn");
        const tabSignUp = document.getElementById("tabSignUp");
        const loginNameContainer = document.getElementById("loginNameContainer");

        const updateTabUI = () => {
            if (activeTab === "login") {
                tabLogIn.className = "flex-1 pb-2 text-xs font-bold text-center border-b-2 border-purple-500 text-purple-400 focus:outline-none cursor-pointer transition-all";
                tabSignUp.className = "flex-1 pb-2 text-xs font-bold text-center border-b-2 border-transparent text-gray-500 hover:text-gray-300 focus:outline-none cursor-pointer transition-all";
                loginNameContainer.classList.add("hidden");
            } else {
                tabLogIn.className = "flex-1 pb-2 text-xs font-bold text-center border-b-2 border-transparent text-gray-500 hover:text-gray-300 focus:outline-none cursor-pointer transition-all";
                tabSignUp.className = "flex-1 pb-2 text-xs font-bold text-center border-b-2 border-purple-500 text-purple-400 focus:outline-none cursor-pointer transition-all";
                loginNameContainer.classList.remove("hidden");
            }
        };

        tabLogIn.onclick = () => {
            activeTab = "login";
            updateTabUI();
        };

        tabSignUp.onclick = () => {
            activeTab = "signup";
            updateTabUI();
        };


        const toggleBtn = document.getElementById("togglePasswordVisibilityBtn");
        const passwordInput = document.getElementById("loginPassword");
        const eyeIcon = document.getElementById("eyeIcon");
        
        if (toggleBtn && passwordInput && eyeIcon) {
            toggleBtn.onclick = () => {
                const isPassword = passwordInput.type === "password";
                passwordInput.type = isPassword ? "text" : "password";
                if (isPassword) {
                    eyeIcon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.822 7.822L21 21m-3.228-3.228l-2.28-2.28m0 0a3 3 0 11-4.243-4.243m4.242 4.242L9.88 9.88" />
                    `;
                } else {
                    eyeIcon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    `;
                }
            };
        }
        
        const showVerificationScreen = (email, name, password, devMode) => {
            const otpNote = devMode
                ? `<p class="text-xs text-yellow-400/80 leading-relaxed bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">⚠️ <strong>Dev Mode:</strong> Email delivery is not configured on the server. Check the server/Render logs for the 6-digit code.</p>`
                : `<p class="text-xs text-gray-400 leading-relaxed">We sent a 6-digit code to <strong class="text-white">${escHtml(email)}</strong>. Check your inbox (and spam folder).</p>`;

            syncText.innerHTML = `
                <div class="flex flex-col gap-3 mt-1">
                    <span class="text-xs font-bold text-purple-400">EMAIL VERIFICATION</span>
                    ${otpNote}
                    <input type="text" id="otpCode" placeholder="Enter 6-digit code (e.g. 123456)" class="bg-[#120e26] border border-white/10 rounded-xl px-3 py-2 text-xs text-white text-center tracking-widest placeholder:text-gray-500 placeholder:tracking-normal focus:outline-none focus:border-purple-500/40 w-full" maxlength="6" autocomplete="one-time-code" inputmode="numeric">
                </div>
            `;
            
            authActions.innerHTML = `
                <button id="verifyOtpBtn" class="text-xs font-bold px-4 py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-500 transition-all cursor-pointer">Verify &amp; Sign Up</button>
                <button id="cancelOtpBtn" class="text-xs font-bold px-4 py-2 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer">Back</button>
            `;

            document.getElementById("cancelOtpBtn").onclick = () => {
                showLoginForm();
                document.getElementById("loginEmail").value = email;
                const nameInput = document.getElementById("loginName");
                if (nameInput) nameInput.value = name;
                document.getElementById("loginPassword").value = password;
                activeTab = "signup";
                updateTabUI();
            };

            document.getElementById("verifyOtpBtn").onclick = async () => {
                const code = document.getElementById("otpCode").value.trim();
                if (!code || code.length !== 6) {
                    alert("Please enter the 6-digit verification code.");
                    return;
                }

                const verifyBtn = document.getElementById("verifyOtpBtn");
                try {
                    verifyBtn.disabled = true;
                    verifyBtn.textContent = "Verifying...";

                    // Step 1: Verify the OTP code
                    const verifyRes = await GrammarFlowAPI.request("/auth/verify-code", { email, code }, "POST");
                    if (!verifyRes.success) {
                        alert("Verification Failed: " + (verifyRes.error?.message || "Invalid verification code."));
                        verifyBtn.disabled = false;
                        verifyBtn.textContent = "Verify & Sign Up";
                        return;
                    }

                    // Step 2: Register the user in the database with their password
                    verifyBtn.textContent = "Creating Account...";
                    const registerRes = await GrammarFlowAPI.request("/auth/register", { email, name, password }, "POST");
                    if (!registerRes.success) {
                        alert("Registration Failed: " + (registerRes.error?.message || "Could not create account."));
                        verifyBtn.disabled = false;
                        verifyBtn.textContent = "Verify & Sign Up";
                        return;
                    }

                    // Step 3: Store token and sync session
                    const registeredUser = registerRes.data.user;
                    const token = `mock_token_${email}_${encodeURIComponent(registeredUser.name || name)}`;
                    localStorage.setItem("gf_token", token);
                    
                    // Clear history cache to avoid leak
                    localStorage.removeItem("gf_history_cache");
                    const container = document.getElementById("historyContent");
                    if (container) container.innerHTML = "";

                    await checkAuthState();
                    restoreSyncSection();
                } catch (e) {
                    alert("Sign Up Error: " + e.message);
                    const btn = document.getElementById("verifyOtpBtn");
                    if (btn) { btn.disabled = false; btn.textContent = "Verify & Sign Up"; }
                }
            };
        };


        document.getElementById("confirmLoginBtn").onclick = async () => {
            const email = document.getElementById("loginEmail").value.trim();
            const name = activeTab === "signup" ? document.getElementById("loginName").value.trim() : "";
            const password = passwordInput.value.trim();
            
            if (activeTab === "signup") {
                if (!email || !name || !password) {
                    alert("Please fill in all fields (Email, Name, and Password).");
                    return;
                }
            } else {
                if (!email || !password) {
                    alert("Please fill in all fields (Email and Password).");
                    return;
                }
            }

            // Client-side Email Validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert("Please enter a valid email address.");
                return;
            }
            
            // Password Validation: 8+ chars, lowercase, uppercase, special symbol
            const hasMinLength = password.length >= 8;
            const hasLowercase = /[a-z]/.test(password);
            const hasUppercase = /[A-Z]/.test(password);
            const hasSpecialSym = /[!@#$%^&*(),.?":{}|<>_\-]/.test(password);
            
            if (!hasMinLength || !hasLowercase || !hasUppercase || !hasSpecialSym) {
                alert("Password must be at least 8 characters long and contain at least one lowercase letter, one uppercase letter, and one special symbol (e.g. @, #, $, %, etc.).");
                return;
            }
            
            if (activeTab === "signup") {
                try {
                    document.getElementById("confirmLoginBtn").disabled = true;
                    document.getElementById("confirmLoginBtn").textContent = "Sending Code...";
                    
                    const res = await GrammarFlowAPI.request("/auth/send-verification-code", { email }, "POST");
                    if (res.success) {
                        // devMode=true means no SMTP is configured, code is only in server logs
                        const isDevMode = res.data && res.data.devMode === true;
                        showVerificationScreen(email, name, password, isDevMode);
                    } else {
                        alert("Failed to send verification code: " + (res.error?.message || "Unknown error"));
                        document.getElementById("confirmLoginBtn").disabled = false;
                        document.getElementById("confirmLoginBtn").textContent = "Confirm";
                    }
                } catch (e) {
                    alert("Request Error: " + e.message);
                    document.getElementById("confirmLoginBtn").disabled = false;
                    document.getElementById("confirmLoginBtn").textContent = "Confirm";
                }
            } else {
                try {
                    document.getElementById("confirmLoginBtn").disabled = true;
                    document.getElementById("confirmLoginBtn").textContent = "Checking...";
                    
                    const res = await GrammarFlowAPI.request("/auth/login", { email, password }, "POST");
                    if (res.success && res.data && res.data.user) {
                        document.getElementById("confirmLoginBtn").textContent = "Syncing...";
                        const nameToUse = res.data.user.name || 'Test User';
                        const token = `mock_token_${email}_${encodeURIComponent(nameToUse)}`;
                        localStorage.setItem("gf_token", token);
                        
                        // Clear history cache to avoid leak
                        localStorage.removeItem("gf_history_cache");
                        const container = document.getElementById("historyContent");
                        if (container) container.innerHTML = "";
                        
                        await checkAuthState();
                        restoreSyncSection();
                    } else {
                        alert("Login Failed: " + (res.error?.message || "Account not registered. Please Sign Up first."));
                        document.getElementById("confirmLoginBtn").disabled = false;
                        document.getElementById("confirmLoginBtn").textContent = "Confirm";
                    }
                } catch (e) {
                    alert("Login Error: " + (e.message || "Account not registered. Please Sign Up first."));
                    document.getElementById("confirmLoginBtn").disabled = false;
                    document.getElementById("confirmLoginBtn").textContent = "Confirm";
                }
            }
        };
    };

    const performSignOut = () => {
        localStorage.removeItem("gf_token");
        localStorage.removeItem("gf_history_cache");
        localStorage.removeItem("guest_session_id");
        const container = document.getElementById("historyContent");
        if (container) container.innerHTML = "";
        getOrCreateGuestSessionId();
        checkAuthState();
        if (historyModal && !historyModal.classList.contains("hidden")) {
            loadHistory();
        }
    };

    // Load paginated list of history items
    const loadHistory = async () => {
        const container = document.getElementById("historyContent");
        if (!container) return;

        // ─── AUTH GATE ────────────────────────────────────────────────────────
        // If Clerk is loaded and the user is signed out, show empty state immediately.
        // Never call the API when the user is not authenticated — this prevents
        // history from leaking after logout regardless of any other timing issues.
        const isClerkReady = !!(window.Clerk && window.Clerk.user !== undefined);
        const isClerkSignedIn = !!(window.Clerk && window.Clerk.user);
        const storedToken = localStorage.getItem("gf_token");

        if (isClerkReady && !isClerkSignedIn && !storedToken) {
            // Clerk is loaded and user is definitely signed out
            container.innerHTML = `
                <div class="text-center py-12 flex flex-col items-center gap-3">
                    <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                    <p class="text-gray-400 font-medium text-sm">Sign in to view your writing history</p>
                    <p class="text-gray-600 text-xs text-center px-6">Your history is saved to your account. Sign in to access it from any device.</p>
                </div>
            `;
            return;
        }
        // ─── END AUTH GATE ────────────────────────────────────────────────────

        container.innerHTML = `<p class="text-gray-400 text-center py-8">Loading history...</p>`;
        
        try {
            const res = await GrammarFlowAPI.request("/history?page=1&limit=20", undefined, "GET");
            if (res.success && res.data && res.data.operations) {
                const ops = res.data.operations;
                
                // Cache history items locally
                localStorage.setItem("gf_history_cache", JSON.stringify(ops));
                
                renderHistoryList(ops, res.data.offline);
            } else {
                loadHistoryFromCache(container);
            }
        } catch (err) {
            console.warn("[HISTORY] Failed to fetch live history, falling back to local cache:", err.message);
            loadHistoryFromCache(container);
        }
    };

    const loadHistoryFromCache = (container) => {
        const cached = localStorage.getItem("gf_history_cache");
        if (cached) {
            try {
                const ops = JSON.parse(cached);
                renderHistoryList(ops, true); // true indicates offline mode
                return;
            } catch (e) {
                console.error("[HISTORY] Failed to parse cached history:", e);
            }
        }
        container.innerHTML = `
            <div class="text-center py-12 flex flex-col items-center gap-3">
                <svg class="w-10 h-10 text-red-500/50" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <p class="text-red-400 font-bold text-sm">Failed to retrieve history</p>
                <p class="text-gray-500 text-xs px-6 text-center">We couldn't connect to retrieve your history, and no offline backup is cached on this device. Start the server or check your network.</p>
            </div>
        `;
    };

    const renderHistoryList = (ops, isOffline = false) => {
        const container = document.getElementById("historyContent");
        if (!container) return;
        
        if (ops.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 flex flex-col items-center gap-3">
                    <svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364.364l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    <p class="text-gray-400 font-medium text-sm">No writing history found</p>
                    <p class="text-gray-600 text-xs text-center px-6">Your grammar corrections and paragraph rewrites will appear here.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = "";
        
        if (isOffline) {
            const badge = document.createElement("div");
            badge.className = "text-center text-[10px] font-bold text-yellow-500 bg-yellow-500/10 py-2.5 rounded-xl border border-yellow-500/20 mb-3 flex items-center justify-center gap-1.5 animate-pulse";
            badge.innerHTML = `⚠️ Viewing Offline History Cache`;
            container.appendChild(badge);
        }
        
        ops.forEach(op => {
            const date = new Date(op.created_at).toLocaleDateString(undefined, { 
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            });
            
            const card = document.createElement("div");
            card.className = "p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between hover:border-purple-500/30 transition-all group cursor-pointer mb-2.5";
            card.dataset.id = op.id;
            card.style.transition = "opacity 0.25s ease, transform 0.25s ease, max-height 0.3s ease";
            
            let iconSvg = `<svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>`;
            if (op.operation_type === 'grammar_fix' || op.operation_type === 'grammar-fix') {
                iconSvg = `<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
            }
            
            card.innerHTML = `
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-purple-500/10 group-hover:border-purple-500/20 transition-all shrink-0">
                        ${iconSvg}
                    </div>
                    <div class="flex flex-col min-w-0">
                        <span class="text-xs font-bold text-gray-200 capitalize tracking-wide">${op.operation_type.replace(/_/g, ' ').replace(/-/g, ' ')}</span>
                        <span class="text-[10px] text-gray-500 font-medium mt-0.5">${date} · ${op.language || 'English'} (${op.style || 'Casual'})</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    ${op.cached ? `<span class="text-[9px] font-bold text-green-400 uppercase tracking-widest bg-green-500/10 px-2 py-0.5 rounded border border-green-500/25">Cached</span>` : ''}
                    <button class="delete-history-btn opacity-70 hover:opacity-100 transition-all w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400" data-id="${op.id}" title="Delete this entry">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                    <svg class="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                </div>
            `;
            
            // Open detail on card click
            card.onclick = () => showHistoryDetail(op.id);

            // Delete button — stop propagation so card click doesn't fire
            const deleteBtn = card.querySelector(".delete-history-btn");
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                deleteBtn.disabled = true;
                deleteBtn.innerHTML = `<svg class="w-3 h-3 animate-spin pointer-events-none" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>`;

                try {
                    const res = await GrammarFlowAPI.request(`/history/${op.id}`, undefined, "DELETE");
                    if (res.success) {
                        // Smooth fade + shrink out
                        card.style.opacity = "0";
                        card.style.transform = "translateX(12px)";
                        setTimeout(() => {
                            card.remove();
                            // Show empty state if no cards left
                            const remaining = container.querySelectorAll("[data-id]");
                            if (remaining.length === 0) renderHistoryList([], isOffline);
                        }, 280);
                    } else {
                        deleteBtn.disabled = false;
                        deleteBtn.innerHTML = `<svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
                        alert("Couldn't delete: " + (res.error?.message || "Unknown error"));
                    }
                } catch (err) {
                    deleteBtn.disabled = false;
                    deleteBtn.innerHTML = `<svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
                    alert("Delete failed: " + err.message);
                }
            };

            container.appendChild(card);
        });
    };


    // Load detailed view of specific operation
    const showHistoryDetail = async (opId) => {
        const container = document.getElementById("historyContent");
        if (!container) return;
        
        container.innerHTML = `<p class="text-gray-400 text-center py-8">Loading details...</p>`;
        
        try {
            const res = await GrammarFlowAPI.request(`/history/${opId}`, undefined, "GET");
            if (res.success && res.data) {
                const op = res.data;
                
                // Cache details locally
                localStorage.setItem(`gf_history_detail_${opId}`, JSON.stringify(op));
                
                renderHistoryDetail(op);
            } else {
                loadDetailFromCache(container, opId);
            }
        } catch (err) {
            console.warn("[HISTORY] Failed to fetch live detail, falling back to local cache:", err.message);
            loadDetailFromCache(container, opId);
        }
    };

    const loadDetailFromCache = (container, opId) => {
        const cached = localStorage.getItem(`gf_history_detail_${opId}`);
        if (cached) {
            try {
                const op = JSON.parse(cached);
                renderHistoryDetail(op, true); // true indicates offline mode
                return;
            } catch (e) {
                console.error(e);
            }
        }
        container.innerHTML = `
            <div class="flex flex-col gap-5">
                <button id="backToHistoryBtn" class="self-start text-xs font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
                    Back to History
                </button>
                <div class="text-center py-8">
                    <p class="text-red-400 text-xs font-bold">Detail View Offline</p>
                    <p class="text-gray-500 text-xs px-6 mt-1 text-center">These operation details have not been cached locally. Reconnect to load.</p>
                </div>
            </div>
        `;
        document.getElementById("backToHistoryBtn").onclick = loadHistory;
    };

    const renderHistoryDetail = (op, isOffline = false) => {
        const container = document.getElementById("historyContent");
        if (!container) return;
        
        const date = new Date(op.created_at).toLocaleString();
        
        container.innerHTML = `
            <div class="flex flex-col gap-5">
                <button id="backToHistoryBtn" class="self-start text-xs font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
                    Back to History
                </button>
                
                ${isOffline ? `
                <div class="text-center text-[10px] font-bold text-yellow-500 bg-yellow-500/10 py-2 rounded-xl border border-yellow-500/20">
                    ⚠️ Viewing Offline Cached Details
                </div>` : ''}
                
                <div class="flex flex-wrap gap-4 text-xs bg-white/5 border border-white/10 rounded-2xl p-4">
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Operation</span>
                        <span class="text-gray-200 capitalize font-medium">${op.operation_type}</span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Date</span>
                        <span class="text-gray-200 font-medium">${date}</span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Language</span>
                        <span class="text-gray-200 font-medium">${op.language || 'English'}</span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Style / Tone</span>
                        <span class="text-gray-200 font-medium">${op.style || 'Casual'} / ${op.tone || 'Friendly'}</span>
                    </div>
                </div>
                
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Original Text</span>
                    <div class="p-4 bg-black/40 border border-white/5 rounded-2xl text-sm text-gray-300 whitespace-pre-wrap max-h-36 overflow-y-auto custom-scrollbar select-all">${escHtml(op.input_text || '')}</div>
                </div>
                
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">AI Output</span>
                    <div class="p-4 bg-purple-950/20 border border-purple-500/10 rounded-2xl text-sm text-white whitespace-pre-wrap max-h-36 overflow-y-auto custom-scrollbar select-all">${escHtml(op.output_text || '')}</div>
                </div>
                
                <button id="restoreToEditorBtn" class="py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-blue-500 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all cursor-pointer">
                    Restore Output to Editor
                </button>
            </div>
        `;
        
        document.getElementById("backToHistoryBtn").onclick = loadHistory;
        document.getElementById("restoreToEditorBtn").onclick = () => {
            const textarea = document.getElementById("inputText");
            if (textarea) {
                textarea.value = op.output_text;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                const historyModal = document.getElementById("historyModal");
                if (historyModal) historyModal.classList.add("hidden");
            }
        };
    };

    // Auto-verify Auth State on Load
    (async () => {
        await initClerk();
        await checkAuthState();
    })();

    // Set initial tab state
    window.documentProcessor.switchTab('text');
});

/* ═══════════════════════════════════════════════════════
   GrammarFlow — Flow-State Expand Mode
   The original textarea is UNCHANGED.
   When the textarea fills up (or user clicks expand),
   a full-screen immersive flow canvas opens over the page.
   On close, text is written back to the textarea.
   ═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const inputText    = document.getElementById('inputText');
    const expandBtn    = document.getElementById('expandFlowBtn');
    const overlay      = document.getElementById('flowOverlay');
    const closeBtn     = document.getElementById('closeFlowBtn');
    const flowCanvas   = document.getElementById('flowOverlayCanvas');
    const flowStrips   = document.getElementById('flowOverlayStrips');
    const flowWords    = document.getElementById('flowOverlayWords');
    const flowTimer    = document.getElementById('flowOverlayTimer');
    const flowSave     = document.getElementById('flowOverlaySave');
    const cameraTrack  = document.getElementById('fovCameraTrack');

    if (!inputText || !expandBtn || !overlay) return;

    /* ── State ── */
    const SAVE_KEY    = 'gf_flow_v2';
    const COMPRESS_AT = 10;
    const KEEP_LAST   = 5;
    let paras         = [];
    let activeIdx     = 0;
    let strips        = [];
    let saveTimer     = null;
    let hudTimer      = null;
    let sessionStart  = Date.now();
    let isOpen        = false;
    
    // Cognitive Flow State Variables
    let stripFocusIdx = -1;
    let momentumTimer = null;
    let isHighMomentum = false;
    let pendingCompress = false;

    /* ── Session timer ── */
    const timerIv = setInterval(() => {
        if (!isOpen) return;
        const s = Math.floor((Date.now() - sessionStart) / 1000);
        const m = Math.floor(s / 60), sec = String(s % 60).padStart(2, '0');
        if (flowTimer) flowTimer.textContent = m + ':' + sec;
    }, 1000);

    function esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /* ── Word count ── */
    function updateWords() {
        const all = allTexts().join(' ');
        const wc  = all.split(/\s+/).filter(Boolean).length;
        if (flowWords) flowWords.textContent = wc + ' words';
    }

    function allTexts() {
        const fromStrips = strips.flatMap(s => s.paragraphs);
        const fromCanvas = paras.map(p => p.querySelector('textarea').value);
        return [...fromStrips, ...fromCanvas];
    }

    /* ── Save ── */
    function scheduleSave() {
        if (flowSave) flowSave.classList.add('unsaved');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(doSave, 20000);
    }

    function doSave() {
        const data = { paragraphs: paras.map(p => p.querySelector('textarea').value), strips, ts: Date.now() };
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch(_) {}
        if (flowSave) { flowSave.classList.remove('unsaved'); flowSave.title = 'Saved ' + new Date().toLocaleTimeString(); }
    }

    /* ── Context Strips ── */
    function renderStrips() {
        if (!flowStrips) return;
        flowStrips.innerHTML = '';
        strips.forEach((s, i) => {
            const el = document.createElement('div');
            el.className = 'fov-strip';
            el.innerHTML = `<span class="fov-strip-num">§${i+1}</span>
                <span class="fov-strip-prev">${esc(s.preview)}…</span>
                <span class="fov-strip-icon">▶</span>
                <div class="fov-strip-body">${esc(s.full)}</div>`;
            el.addEventListener('click', () => {
                const wasOpen = el.classList.contains('open');
                flowStrips.querySelectorAll('.fov-strip').forEach(x => x.classList.remove('open'));
                if (!wasOpen) el.classList.add('open');
            });
            flowStrips.appendChild(el);
        });
        updateStripFocus();
    }

    function updateStripFocus() {
        if (!flowStrips) return;
        const els = flowStrips.querySelectorAll('.fov-strip');
        els.forEach((el, i) => el.classList.toggle('fov-strip-focused', i === stripFocusIdx));
        if (stripFocusIdx >= 0 && els[stripFocusIdx]) {
            els[stripFocusIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function compress() {
        if (paras.length < COMPRESS_AT) return;
        if (isHighMomentum) {
            pendingCompress = true;
            return;
        }
        pendingCompress = false;
        const toCompress = paras.slice(0, paras.length - KEEP_LAST);
        if (!toCompress.length) return;
        
        toCompress.forEach(p => p.classList.add('fov-condensing'));
        
        setTimeout(() => {
            const texts  = toCompress.map(p => p.querySelector('textarea').value);
            const full   = texts.join('\n\n');
            strips.push({ preview: full.replace(/\s+/g,' ').trim().slice(0,70), full, paragraphs: texts });
            toCompress.forEach(p => {
                if(cameraTrack && cameraTrack.contains(p)) cameraTrack.removeChild(p);
            });
            paras = paras.slice(paras.length - KEEP_LAST);
            activeIdx = paras.length - 1;
            setActive(activeIdx);
            renderStrips();
        }, 400); // Wait for condense animation
    }

    /* ── Paragraph factory ── */
    function addPara(text, doFocus) {
        const wrap = document.createElement('div');
        wrap.className = 'fov-para' + (doFocus ? ' fov-active' : ' fov-dimmed-1');
        wrap.style.cssText = 'position:relative;display:block;width:100%;';

        const ta = document.createElement('textarea');
        ta.value = text || '';
        ta.rows = 1;
        ta.placeholder = 'Keep writing…';
        ta.spellcheck = false;
        ta.style.cssText = [
            'display:block','width:100%','background:transparent','border:none',
            'outline:none','resize:none','box-shadow:none','box-sizing:border-box',
            'font-family:Inter,sans-serif','font-size:1.2rem','line-height:1.85',
            'color:rgba(255,255,255,0.92)','caret-color:#a855f7',
            'padding:6px 0','min-height:36px','overflow:hidden','text-align:left'
        ].join(';');

        wrap.appendChild(ta);
        if(cameraTrack) cameraTrack.appendChild(wrap);
        paras.push(wrap);

        autoH(ta);
        ta.addEventListener('input', () => {
            autoH(ta);
            wrap.classList.toggle('fov-empty', ta.value.trim() === '');
            updateWords();
            scheduleSave();
            
            // Psychological Momentum Engine
            if (!isHighMomentum) {
                isHighMomentum = true;
                overlay.classList.add('momentum-high');
            }
            clearTimeout(momentumTimer);
            momentumTimer = setTimeout(() => {
                isHighMomentum = false;
                overlay.classList.remove('momentum-high');
                if (pendingCompress) compress();
            }, 2500); // Reset momentum after 2.5s pause
            
            // Update virtual camera on text expansion
            if(paras.indexOf(wrap) === activeIdx) setActive(activeIdx);
        });
        ta.addEventListener('focus', () => setActive(paras.indexOf(wrap)));
        ta.addEventListener('keydown', e => handleKey(e, ta));

        if (doFocus) requestAnimationFrame(() => { ta.focus(); setActive(paras.indexOf(wrap)); });
        return wrap;
    }

    function autoH(ta) {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    function setActive(idx) {
        if (idx < 0) return;
        activeIdx = idx;
        paras.forEach((p, i) => {
            p.className = 'fov-para'; // reset
            const dist = Math.abs(i - idx);
            if (dist === 0) p.classList.add('fov-active');
            else if (dist === 1) p.classList.add('fov-dimmed-1');
            else if (dist === 2) p.classList.add('fov-dimmed-2');
            else if (dist === 3) p.classList.add('fov-dimmed-3');
            else p.classList.add('fov-dimmed-far');
        });
        
        // Virtual Camera offset calculation
        const activePara = paras[idx];
        if (activePara && cameraTrack) {
            const trackOffset = activePara.offsetTop;
            const paraHeight = activePara.offsetHeight;
            // Track the bottom of the paragraph so the cursor never falls off-screen for long texts
            const shiftY = -(trackOffset + paraHeight);
            cameraTrack.style.transform = `translateY(${shiftY}px)`;
        }
        
        stripFocusIdx = -1;
        updateStripFocus();
    }

    function handleKey(e, ta) {
        const idx = paras.indexOf(ta.parentElement);
        if (idx < 0) return;

        // Context Strip Keyboard Nav
        if (e.key === 'ArrowUp' && e.ctrlKey) {
            e.preventDefault();
            if (stripFocusIdx === -1) stripFocusIdx = strips.length - 1;
            else if (stripFocusIdx > 0) stripFocusIdx--;
            updateStripFocus();
            return;
        }
        if (e.key === 'ArrowDown' && e.ctrlKey) {
            e.preventDefault();
            if (stripFocusIdx >= 0) {
                stripFocusIdx++;
                if (stripFocusIdx >= strips.length) stripFocusIdx = -1;
                updateStripFocus();
            }
            return;
        }
        if (e.key === 'Enter' && stripFocusIdx >= 0) {
            e.preventDefault();
            const els = flowStrips.querySelectorAll('.fov-strip');
            if (els[stripFocusIdx]) {
                const wasOpen = els[stripFocusIdx].classList.contains('open');
                els.forEach(x => x.classList.remove('open'));
                if (!wasOpen) els[stripFocusIdx].classList.add('open');
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addPara('', true);
            setActive(paras.length - 1);
            scheduleSave();
            if (paras.length >= COMPRESS_AT) compress();
            return;
        }
        if (e.key === 'Backspace' && ta.value === '' && paras.length > 1) {
            e.preventDefault();
            if(cameraTrack && cameraTrack.contains(paras[idx])) cameraTrack.removeChild(paras[idx]);
            paras.splice(idx, 1);
            const ni = Math.max(0, idx - 1);
            setActive(ni);
            const prev = paras[ni].querySelector('textarea');
            prev.focus();
            prev.selectionStart = prev.selectionEnd = prev.value.length;
            return;
        }
        if (e.key === 'ArrowUp' && !e.ctrlKey && idx > 0 && ta.selectionStart === 0) {
            e.preventDefault(); paras[idx-1].querySelector('textarea').focus();
        }
        if (e.key === 'ArrowDown' && !e.ctrlKey && idx < paras.length - 1 && ta.selectionStart === ta.value.length) {
            e.preventDefault(); paras[idx+1].querySelector('textarea').focus();
        }
        if (e.key === 'Escape') closeOverlay();
    }


    /* ── Open overlay ── */
    function openOverlay() {
        if (isOpen) return;
        isOpen = true;
        sessionStart = Date.now();

        // Seed canvas with text from the main textarea
        const seedText = inputText.value || '';
        if(cameraTrack) {
            cameraTrack.innerHTML = '';
            cameraTrack.style.transform = 'translateY(0)';
        }
        paras = [];
        strips = [];
        stripFocusIdx = -1;
        isHighMomentum = false;
        overlay.classList.remove('momentum-high');
        flowStrips.innerHTML = '';

        // Try loading saved state first; fall back to textarea content
        let loaded = false;
        try {
            const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
            if (saved && Array.isArray(saved.paragraphs) && saved.paragraphs.length) {
                const savedFull = [...(saved.strips ? saved.strips.flatMap(s => s.paragraphs) : []), ...saved.paragraphs].join('\n\n');
                
                // ONLY load from save if the external textarea hasn't been manually changed significantly
                if (!seedText || seedText.trim() === savedFull.trim()) {
                    strips = saved.strips || [];
                    renderStrips();
                    saved.paragraphs.forEach((t, i) => addPara(t, i === saved.paragraphs.length - 1));
                    loaded = true;
                }
            }
        } catch(_) {}

        if (!loaded) {
            // Split by ANY newline so pasted blocks correctly break into multiple cinematic paragraphs
            const seedParas = seedText.split(/\n+/).filter(s => s.trim());
            if (seedParas.length) seedParas.forEach((t, i) => addPara(t, i === seedParas.length - 1));
            else addPara('', true);
        }

        updateWords();
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('fov-visible'));
    }

    /* ── Close overlay ── */
    function closeOverlay() {
        if (!isOpen) return;
        doSave();
        // Write text back to the main textarea
        const full = allTexts().join('\n\n');
        inputText.value = full;
        inputText.dispatchEvent(new Event('input', { bubbles: true }));

        overlay.classList.remove('fov-visible');
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.classList.add('hidden');
        }, 350);
        isOpen = false;

        // Refocus the main textarea
        inputText.focus();
    }

    /* ── Trigger: textarea fills up → auto-open ── */
    inputText.addEventListener('input', () => {
        if (isOpen) return;
        if (inputText.scrollHeight > inputText.clientHeight + 20) {
            openOverlay();
        }
    });

    /* ── Manual trigger ── */
    expandBtn.addEventListener('click', openOverlay);
    closeBtn.addEventListener('click', closeOverlay);
});



