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
    async request(endpoint, payload) {
        const response = await fetch(`${getBaseUrl()}${endpoint}`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-guest-session-id": getOrCreateGuestSessionId()
            },
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
            card.innerHTML = `
                <div class="result-text">${text}</div>
                <button class="copy-btn-mini" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>`;
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



