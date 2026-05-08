/**
 * GrammarFlow - Premium AI Writing Companion
 * Phase 3: Real-time Multilingual Assistance & Momentum Engine
 */

const CONFIG = {
    PRODUCTION_API_URL: "https://grammarflow-brain.onrender.com", 
    API_VERSION: "/api/v1",
    TIMEOUT_MS: 35000
};

const getBaseUrl = () => {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === "file:";
    
    // Only use Production URL if we are NOT on localhost
    if (CONFIG.PRODUCTION_API_URL && !isLocal) return CONFIG.PRODUCTION_API_URL + CONFIG.API_VERSION;
    
    // Default to localhost if local, or relative path if deployed
    return isLocal ? `http://localhost:3000${CONFIG.API_VERSION}` : CONFIG.API_VERSION;
};

const GrammarFlowAPI = {
    async request(endpoint, payload) {
        try {
            const response = await fetch(`${getBaseUrl()}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error?.message || "Server error");
            return data;
        } catch (error) { throw error; }
    }
};

// --- MOMENTUM ENGINE (Adaptive Debounce) ---
class MomentumEngine {
    constructor() {
        this.lastKeystroke = Date.now();
        this.emaDelta = 400; // Initial guess (ms)
        this.alpha = 0.2; // Smoothing factor
        this.modes = {
            QUIET: { debounce: 3500, threshold: 300 }, // Fast typing
            BALANCED: { debounce: 1500, threshold: 700 },
            ASSIST: { debounce: 800, threshold: Infinity } // Slow typing/struggling
        };
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
        if (this.emaDelta < this.modes.QUIET.threshold) return this.modes.QUIET.debounce;
        if (this.emaDelta < this.modes.BALANCED.threshold) return this.modes.BALANCED.debounce;
        return this.modes.ASSIST.debounce;
    }
}

// --- SHADOW HIGHLIGHTER (UI Sync) ---
class ShadowHighlighter {
    constructor(textarea, overlay) {
        this.textarea = textarea;
        this.overlay = overlay;
        this.highlights = [];
        this.sync();
        
        this.textarea.addEventListener('scroll', () => this.syncScroll());
        window.addEventListener('resize', () => this.sync());
    }

    sync() {
        const style = window.getComputedStyle(this.textarea);
        this.overlay.style.width = style.width;
        this.overlay.style.height = style.height;
        this.overlay.style.padding = style.padding;
        this.overlay.style.fontSize = style.fontSize;
        this.overlay.style.lineHeight = style.lineHeight;
        this.overlay.style.fontFamily = style.fontFamily;
        this.render();
    }

    syncScroll() {
        this.overlay.scrollTop = this.textarea.scrollTop;
        this.overlay.scrollLeft = this.textarea.scrollLeft;
    }

    setHighlights(highlights) {
        this.highlights = highlights;
        this.render();
    }

    render() {
        let content = this.textarea.value;
        if (!content) {
            this.overlay.innerHTML = "";
            return;
        }

        // Sort highlights by start position descending
        const sorted = [...this.highlights].sort((a, b) => {
            const startA = content.indexOf(a.original);
            const startB = content.indexOf(b.original);
            return startB - startA;
        });

        let html = content.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        
        sorted.forEach(h => {
            const type = (h.category || 'grammar').toLowerCase();
            const escapedOriginal = h.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedOriginal, 'g');
            html = html.replace(regex, `<span class="highlight-${type}">$&</span>`);
        });

        this.overlay.innerHTML = html + "\n"; 
    }
}

// --- SENTENCE TRACKER ---
const SentenceTracker = {
    getActiveSentence(text, cursorSource) {
        const cursor = cursorSource.selectionStart;
        const sentences = text.split(/([.!?\n])/);
        let currentPos = 0;
        for (let i = 0; i < sentences.length; i++) {
            currentPos += sentences[i].length;
            if (currentPos >= cursor) {
                return (sentences[i] + (sentences[i+1] || "")).trim();
            }
        }
        return text.trim();
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const UI = {
        inputText: document.getElementById("inputText"),
        highlighterOverlay: document.getElementById("highlighterOverlay"),
        styleSelect: document.getElementById("styleSelect"),
        toneSelect: document.getElementById("toneSelect"),
        languageSelect: document.getElementById("languageSelect"),
        humanizeToggle: document.getElementById("humanizeToggle"),
        rewriteBtn: document.getElementById("rewriteBtn"),
        fixGrammarBtn: document.getElementById("fixGrammarBtn"),
        outputSection: document.getElementById("outputSection"),
        loadingIndicator: document.getElementById("loadingIndicator"),
        resultsList: document.getElementById("resultsList"),
        assistantBar: document.getElementById("assistantBar"),
        suggestionText: document.getElementById("suggestionText"),
        suggestionLabel: document.getElementById("suggestionLabel"),
        applyBtn: document.getElementById("applySuggestionBtn"),
        appLogo: document.getElementById("appLogo")
    };

    const momentum = new MomentumEngine();
    const highlighter = new ShadowHighlighter(UI.inputText, UI.highlighterOverlay);
    
    let assistantTimer = null;
    let lastRequestId = 0;
    let isProcessing = false;

    const setBusy = (busy) => {
        isProcessing = busy;
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
                <button class="copy-btn-mini" onclick="navigator.clipboard.writeText('${text.replace(/'/g, "\\'")}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
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
        if (text.length < 5) {
            UI.assistantBar.classList.remove("visible");
            UI.appLogo.classList.remove("notifying");
            highlighter.setHighlights([]);
            return;
        }

        const debounceTime = momentum.getDebounce();
        const requestId = ++lastRequestId;

        // Show "Thinking" state
        UI.appLogo.classList.add("notifying");

        assistantTimer = setTimeout(async () => {
            const rawText = UI.inputText.value;
            const activeSentence = SentenceTracker.getActiveSentence(rawText, UI.inputText);
            
            const context = activeSentence.length < 5 ? rawText.trim() : activeSentence;
            console.log("[Real-time] Context for analysis:", context);
            
            if (context.length < 5) {
                UI.appLogo.classList.remove("notifying");
                return;
            }

            try {
                console.log("[Real-time] Sending request to:", getBaseUrl());
                const res = await GrammarFlowAPI.request("/analyze-realtime", {
                    text: context,
                    language: UI.languageSelect.value,
                    humanize: UI.humanizeToggle.checked
                });

                console.log("[Real-time] Response received:", res);

                if (requestId !== lastRequestId) return;
                UI.appLogo.classList.remove("notifying");

                if (res.success && res.data && res.data.length > 0) {
                    const sug = res.data[0];
                    // Relaxed threshold for better "talkativeness"
                    if (sug.confidence < 0.4) {
                        UI.assistantBar.classList.remove("visible");
                        return;
                    }

                    UI.suggestionLabel.innerText = sug.category || "SUGGESTION";
                    UI.suggestionText.innerHTML = `Consider: "<b>${sug.suggestion}</b>" <span style="opacity: 0.6; font-size: 0.8rem;">(${sug.reason})</span>`;
                    UI.assistantBar.classList.add("visible");
                    UI.appLogo.classList.add("notifying");

                    highlighter.setHighlights(res.data);

                    UI.applyBtn.onclick = () => {
                        const currentText = UI.inputText.value;
                        const newText = currentText.replace(sug.original, sug.suggestion);
                        UI.inputText.value = newText;
                        highlighter.render();
                        UI.assistantBar.classList.remove("visible");
                        UI.appLogo.classList.remove("notifying");
                        highlighter.setHighlights([]);
                    };
                } else {
                    UI.assistantBar.classList.remove("visible");
                    UI.appLogo.classList.remove("notifying");
                    highlighter.setHighlights([]);
                }
            } catch (e) { console.error("[Real-time] Analysis failed:", e); }
        }, debounceTime);
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
