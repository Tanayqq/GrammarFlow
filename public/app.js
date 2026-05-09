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
            if (tab === 'text') {
                UI.tabText.classList.add('active');
                UI.tabDocument.classList.remove('active');
                UI.textModeContainer.classList.remove('hidden');
                UI.textActionButtons.classList.remove('hidden');
                UI.documentModeContainer.classList.add('hidden');
            } else {
                UI.tabDocument.classList.add('active');
                UI.tabText.classList.remove('active');
                UI.documentModeContainer.classList.remove('hidden');
                UI.textActionButtons.classList.add('hidden');
                UI.textModeContainer.classList.add('hidden');
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
                    chip.className = 'file-chip';
                    chip.innerHTML = `<span>${file.name}</span> <span class="remove-file" onclick="documentProcessor.removeFile(${idx})">×</span>`;
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
            const baseMaxChars = 4000; // Drastically reduced for 6,000 TPM strict limits
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
            UI.loadingIndicator.classList.remove("hidden");
            UI.resultsList.innerHTML = '';
            UI.outputSection.classList.remove("hidden");
            document.getElementById("exportControls").classList.add("hidden");
            
            const cancelBtn = document.getElementById("cancelProcessBtn");
            if (cancelBtn) {
                cancelBtn.classList.remove("hidden");
                cancelBtn.onclick = () => { this.isCanceled = true; cancelBtn.innerText = "Canceling..."; };
            }

            const mainFile = this.files[0];
            const mode = UI.documentModeSelect.value;
            const lang = UI.languageSelect.value;
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
                    
                    const chunkResult = await this.requestWithRetry(chunks[i], mode, lang);
                    intermediateResults.push(chunkResult);
                    
                    // Save to Cache
                    localStorage.setItem(cacheKey, JSON.stringify({ results: intermediateResults, nextChunk: i + 1 }));
                    
                    // Progressive Display
                    renderResults(intermediateResults);
                    
                    if (i < chunks.length - 1) {
                        renderResults([...intermediateResults, `Waiting 10s to stay under AI rate limits...`]);
                        await new Promise(r => setTimeout(r, 10000));
                    }
                }

                if (this.isCanceled) throw new Error("Canceled by user.");

                // Final Pass
                let finalResult = "";
                if (chunks.length === 1) {
                    finalResult = intermediateResults[0];
                } else if (mode === "Summarize") {
                    renderResults([...intermediateResults, "Taking a brief pause to prevent AI rate limits... (10s)"]);
                    await new Promise(r => setTimeout(r, 10000)); // 10s cooldown before the heavy final pass
                    
                    renderResults([...intermediateResults, "Finalizing document structure and weaving summaries together... (Please wait)"]);
                    finalResult = await this.hierarchicalConsolidate(intermediateResults, mode, lang);
                } else {
                    finalResult = intermediateResults.join("\\n\\n");
                }

                renderResults([finalResult]);
                this.finalOutput = finalResult;
                document.getElementById("exportControls").classList.remove("hidden");
                localStorage.removeItem(cacheKey); // Clear cache on success

            } catch (e) {
                renderResults([...intermediateResults, `Error: ${e.message}`]);
            } finally {
                setBusy(false);
                if (cancelBtn) { cancelBtn.classList.add("hidden"); cancelBtn.innerText = "Cancel"; }
            }
        }

        async requestWithRetry(text, mode, lang, isConsolidation = false) {
            let retries = 0;
            while (retries < 5) {
                try {
                    const res = await GrammarFlowAPI.request("/process-document", {
                        text, mode, language: lang, 
                        style: UI.styleSelect.value, tone: UI.toneSelect.value, 
                        humanize: UI.humanizeToggle.checked, isConsolidation
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

        async hierarchicalConsolidate(results, mode, lang) {
            const combined = results.join("\\n\\n");
            if (combined.length < 20000) {
                return await this.requestWithRetry(combined, mode, lang, true);
            }
            // If still too large, chunk the results and recurse
            const newChunks = this.chunkText(combined, lang);
            const summarizedChunks = [];
            for (const chunk of newChunks) {
                summarizedChunks.push(await this.requestWithRetry(chunk, mode, lang, true));
            }
            return await this.hierarchicalConsolidate(summarizedChunks, mode, lang);
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

    window.documentProcessor = new DocumentProcessor();
});
