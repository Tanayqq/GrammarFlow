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

const GrammarFlowAPI = {
    async request(endpoint, payload) {
        const response = await fetch(`${getBaseUrl()}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
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
// SENTENCE TRACKER — context extraction
// ─────────────────────────────────────────────
const SentenceTracker = {
    getContext(text, cursorSource) {
        // Long text: send the full paragraph to /analyze-smart
        if (text.length >= 200) return text.trim();
        // Short text: send active sentence to /analyze-realtime
        const cursor = cursorSource.selectionStart;
        const sentences = text.split(/([.!?\n])/);
        let pos = 0;
        for (let i = 0; i < sentences.length; i++) {
            pos += sentences[i].length;
            if (pos >= cursor) return (sentences[i] + (sentences[i + 1] || '')).trim();
        }
        return text.trim();
    }
};

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
        appLogo:            document.getElementById("appLogo")
    };

    const momentum       = new MomentumEngine();
    const highlighter    = new ShadowHighlighter(UI.inputText, UI.highlighterOverlay);
    const contextAnalyzer = new ContextAnalyzer();

    let assistantTimer   = null;
    let lastRequestId    = 0;
    let allSuggestions   = [];
    let currentSugIdx    = 0;

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
        allSuggestions = [];
        currentSugIdx  = 0;
    };

    // ─── NAV BUTTONS ─────────────────────────
    UI.prevBtn.onclick = () => showSuggestion(currentSugIdx - 1);
    UI.nextBtn.onclick = () => showSuggestion(currentSugIdx + 1);

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
        if (busy) {
            UI.loadingIndicator.classList.remove("hidden");
            UI.outputSection.classList.remove("hidden");
            UI.resultsList.innerHTML = "";
        } else {
            UI.loadingIndicator.classList.add("hidden");
        }
    };

    const renderResults = (results) => {
        UI.resultsList.innerHTML = "";
        const data = Array.isArray(results) ? results : [results];
        data.forEach(text => {
            const card = document.createElement("div");
            card.className = "result-card";
            card.innerHTML = `
                <div class="result-text">${text}</div>
                <button class="copy-btn-mini" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>`;
            UI.resultsList.appendChild(card);
        });
    };

    // ─── REAL-TIME LOOP (Phase 3 + Phase 4) ──
    UI.inputText.addEventListener("keydown", () => momentum.recordStroke());
    UI.inputText.addEventListener("input", () => {
        highlighter.render();
        clearTimeout(assistantTimer);

        const rawText = UI.inputText.value;
        const text = rawText.trim();
        if (text.length < 5) { hideAssistant(); return; }

        const debounce  = momentum.getDebounce();
        const requestId = ++lastRequestId;
        UI.appLogo.classList.add("notifying");

        assistantTimer = setTimeout(async () => {
            const context = SentenceTracker.getContext(rawText, UI.inputText);
            if (context.length < 5) { UI.appLogo.classList.remove("notifying"); return; }

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
    UI.rewriteBtn.onclick = async () => {
        const text = UI.inputText.value.trim();
        if (!text) return;
        setBusy(true);
        try {
            const res = await GrammarFlowAPI.request("/rewrite", {
                text, style: UI.styleSelect.value, tone: UI.toneSelect.value,
                language: UI.languageSelect.value, humanize: UI.humanizeToggle.checked
            });
            renderResults(res.data);
        } catch (e) { renderResults([`Error: ${e.message}`]); }
        finally { setBusy(false); }
    };

    UI.fixGrammarBtn.onclick = async () => {
        const text = UI.inputText.value.trim();
        if (!text) return;
        setBusy(true);
        try {
            const res = await GrammarFlowAPI.request("/grammar-fix", {
                text, language: UI.languageSelect.value, humanize: UI.humanizeToggle.checked
            });
            renderResults(res.data);
        } catch (e) { renderResults([`Error: ${e.message}`]); }
        finally { setBusy(false); }
    };
});
