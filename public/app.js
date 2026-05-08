/**
 * GrammarFlow - Premium AI Writing Companion
 * Phase 3: Real-time Multilingual Assistance & Momentum Engine
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

// --- MOMENTUM ENGINE ---
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
        if (this.emaDelta < 300) return 3000;   // Fast typing - back off
        if (this.emaDelta < 700) return 1500;   // Balanced
        return 900;                              // Slow / paused - assist quickly
    }
}

// --- SHADOW HIGHLIGHTER ---
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
        if (!content || !this.highlights.length) {
            this.overlay.innerHTML = "";
            return;
        }
        let html = content.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        // Apply highlights in reverse order to avoid index shifts
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

// --- SENTENCE TRACKER ---
const SentenceTracker = {
    getContext(text, cursorSource) {
        // For long text (> 200 chars), analyze the whole document for richer suggestions
        if (text.length > 200) return text.trim();
        
        const cursor = cursorSource.selectionStart;
        const sentences = text.split(/([.!?\n])/);
        let pos = 0;
        for (let i = 0; i < sentences.length; i++) {
            pos += sentences[i].length;
            if (pos >= cursor) {
                return (sentences[i] + (sentences[i + 1] || '')).trim();
            }
        }
        return text.trim();
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const UI = {
        inputText:       document.getElementById("inputText"),
        highlighterOverlay: document.getElementById("highlighterOverlay"),
        styleSelect:     document.getElementById("styleSelect"),
        toneSelect:      document.getElementById("toneSelect"),
        languageSelect:  document.getElementById("languageSelect"),
        humanizeToggle:  document.getElementById("humanizeToggle"),
        rewriteBtn:      document.getElementById("rewriteBtn"),
        fixGrammarBtn:   document.getElementById("fixGrammarBtn"),
        outputSection:   document.getElementById("outputSection"),
        loadingIndicator:document.getElementById("loadingIndicator"),
        resultsList:     document.getElementById("resultsList"),
        assistantBar:    document.getElementById("assistantBar"),
        suggestionText:  document.getElementById("suggestionText"),
        suggestionLabel: document.getElementById("suggestionLabel"),
        suggestionCounter: document.getElementById("suggestionCounter"),
        applyBtn:        document.getElementById("applySuggestionBtn"),
        prevBtn:         document.getElementById("prevSuggestionBtn"),
        nextBtn:         document.getElementById("nextSuggestionBtn"),
        appLogo:         document.getElementById("appLogo")
    };

    const momentum = new MomentumEngine();
    const highlighter = new ShadowHighlighter(UI.inputText, UI.highlighterOverlay);

    let assistantTimer = null;
    let lastRequestId = 0;
    let allSuggestions = [];   // All suggestions from current API call
    let currentSugIdx = 0;    // Which one we're showing

    // --- DISPLAY A SPECIFIC SUGGESTION ---
    const showSuggestion = (idx) => {
        if (!allSuggestions.length) return;
        currentSugIdx = Math.max(0, Math.min(idx, allSuggestions.length - 1));
        const sug = allSuggestions[currentSugIdx];

        UI.suggestionLabel.innerText = (sug.category || 'SUGGESTION').toUpperCase();
        UI.suggestionText.innerHTML = `Consider: "<b>${sug.suggestion}</b>" <span style="opacity:0.55;font-size:0.8rem">(${sug.reason || ''})</span>`;
        
        // Counter: "2 of 4"
        if (allSuggestions.length > 1) {
            UI.suggestionCounter.textContent = `${currentSugIdx + 1} of ${allSuggestions.length}`;
            UI.suggestionCounter.style.display = 'inline-block';
        } else {
            UI.suggestionCounter.style.display = 'none';
        }

        // Nav button states
        UI.prevBtn.disabled = currentSugIdx === 0;
        UI.nextBtn.disabled = currentSugIdx === allSuggestions.length - 1;

        // Highlight just this suggestion
        highlighter.setHighlights([sug]);

        UI.assistantBar.classList.add("visible");
        UI.appLogo.classList.add("notifying");
    };

    const hideAssistant = () => {
        UI.assistantBar.classList.remove("visible");
        UI.appLogo.classList.remove("notifying");
        highlighter.setHighlights([]);
        allSuggestions = [];
        currentSugIdx = 0;
    };

    // Nav button handlers
    UI.prevBtn.onclick = () => showSuggestion(currentSugIdx - 1);
    UI.nextBtn.onclick = () => showSuggestion(currentSugIdx + 1);

    // Apply current suggestion
    UI.applyBtn.onclick = () => {
        const sug = allSuggestions[currentSugIdx];
        if (!sug) return;
        UI.inputText.value = UI.inputText.value.replace(sug.original, sug.suggestion);
        // Remove applied suggestion and move to next if possible
        allSuggestions.splice(currentSugIdx, 1);
        if (allSuggestions.length === 0) {
            hideAssistant();
        } else {
            showSuggestion(Math.min(currentSugIdx, allSuggestions.length - 1));
        }
        highlighter.render();
    };

    const setBusy = (busy) => {
        UI.rewriteBtn.disabled = busy;
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
                </button>
            `;
            UI.resultsList.appendChild(card);
        });
    };

    // --- REAL-TIME LOOP ---
    UI.inputText.addEventListener("keydown", () => momentum.recordStroke());
    UI.inputText.addEventListener("input", () => {
        highlighter.render();
        clearTimeout(assistantTimer);

        const text = UI.inputText.value.trim();
        if (text.length < 5) { hideAssistant(); return; }

        const debounce = momentum.getDebounce();
        const requestId = ++lastRequestId;
        UI.appLogo.classList.add("notifying");

        assistantTimer = setTimeout(async () => {
            const context = SentenceTracker.getContext(UI.inputText.value, UI.inputText);
            if (context.length < 5) { UI.appLogo.classList.remove("notifying"); return; }

            try {
                console.log("[RT] Analyzing:", context.substring(0, 60) + "...");
                const res = await GrammarFlowAPI.request("/analyze-realtime", {
                    text: context,
                    language: UI.languageSelect.value,
                    humanize: UI.humanizeToggle.checked
                });

                if (requestId !== lastRequestId) return;
                UI.appLogo.classList.remove("notifying");

                console.log("[RT] Got", res.data?.length, "suggestions:", res.data);

                if (res.success && res.data && res.data.length > 0) {
                    // Filter by confidence threshold
                    const valid = res.data.filter(s => (s.confidence || 1) >= 0.4);
                    if (!valid.length) { hideAssistant(); return; }
                    allSuggestions = valid;
                    showSuggestion(0);
                } else {
                    hideAssistant();
                }
            } catch (e) {
                console.error("[RT] Failed:", e.message);
                UI.appLogo.classList.remove("notifying");
            }
        }, debounce);
    });

    // --- MANUAL ACTIONS ---
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
