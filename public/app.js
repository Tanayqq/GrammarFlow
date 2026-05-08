/**
 * GrammarFlow - Production API Client & UI Logic
 */

// 1. API Configuration
const CONFIG = {
    PRODUCTION_API_URL: "", // e.g. "https://grammarflow.onrender.com"
    API_VERSION: "/api/v1",
    TIMEOUT_MS: 35000
};

const getBaseUrl = () => {
    if (CONFIG.PRODUCTION_API_URL) return CONFIG.PRODUCTION_API_URL + CONFIG.API_VERSION;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === "file:";
    
    // If local, try port 3000. If cloud (Vercel), assume relative path or error.
    return isLocal ? `http://localhost:3000${CONFIG.API_VERSION}` : CONFIG.API_VERSION;
};

// 2. API Client (Decoupled from UI)
const GrammarFlowAPI = {
    async request(endpoint, payload) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

        try {
            const response = await fetch(`${getBaseUrl()}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                // If it's HTML (Unexpected token <), throw a more helpful error
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("text/html")) {
                    throw new Error("Server returned HTML instead of JSON. The backend might be misconfigured or not running.");
                }
            }

            const data = await response.json();

            if (!response.ok || !data.success) {
                const errorMsg = data.error?.message || `Server Error: ${response.status}`;
                throw new Error(errorMsg);
            }

            return data; // Returns { success, data, metadata }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error("Request timed out. The server is taking too long.");
            if (error instanceof SyntaxError) throw new Error("Backend response error (Invalid JSON). Check if the server is running on port 3000.");
            throw error;
        }
    }
};

// 3. UI Controller
document.addEventListener("DOMContentLoaded", () => {
    const UI = {
        inputText: document.getElementById("inputText"),
        styleSelect: document.getElementById("styleSelect"),
        toneSelect: document.getElementById("toneSelect"),
        languageSelect: document.getElementById("languageSelect"),
        humanizeToggle: document.getElementById("humanizeToggle"),
        rewriteBtn: document.getElementById("rewriteBtn"),
        fixGrammarBtn: document.getElementById("fixGrammarBtn"),
        outputSection: document.getElementById("outputSection"),
        loadingIndicator: document.getElementById("loadingIndicator"),
        resultsList: document.getElementById("resultsList")
    };

    if (!UI.rewriteBtn) return; // Guard for partial loads

    let isProcessing = false;
    let lastRequest = null;

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

    const renderError = (message) => {
        UI.resultsList.innerHTML = `
            <div class="error-message">
                <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <span style="flex-grow: 1;">${message}</span>
                    <button id="retryBtn" class="secondary-btn" style="height: 32px; padding: 0 12px; font-size: 0.8rem;">Retry</button>
                </div>
            </div>
        `;
        UI.outputSection.classList.remove("hidden");

        document.getElementById("retryBtn")?.addEventListener("click", () => {
            if (lastRequest) lastRequest.fn(...lastRequest.args);
        });
    };

    const renderResults = (results) => {
        UI.resultsList.innerHTML = "";
        const data = Array.isArray(results) ? results : [results];

        if (data.length === 0) {
            UI.resultsList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No suggestions found.</div>';
            return;
        }

        data.forEach((text) => {
            const card = document.createElement("div");
            card.className = "result-card";

            const textEl = document.createElement("div");
            textEl.className = "result-text";
            textEl.innerText = text;

            const copyBtn = document.createElement("button");
            copyBtn.className = "copy-btn-mini";
            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

            copyBtn.onclick = () => {
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.classList.add("copied");
                    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                    setTimeout(() => {
                        copyBtn.classList.remove("copied");
                        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                    }, 2000);
                });
            };

            card.appendChild(textEl);
            card.appendChild(copyBtn);
            UI.resultsList.appendChild(card);
        });
        UI.outputSection.classList.remove("hidden");
    };

    const handleRewrite = async () => {
        if (isProcessing) return;
        const text = UI.inputText.value.trim();
        if (!text) return;

        lastRequest = { fn: handleRewrite, args: [] };
        setBusy(true);
        try {
            const response = await GrammarFlowAPI.request("/rewrite", {
                text,
                style: UI.styleSelect.value,
                tone: UI.toneSelect.value,
                language: UI.languageSelect.value,
                humanize: UI.humanizeToggle.checked
            });
            renderResults(response.data);
        } catch (error) {
            renderError(error.message);
        } finally {
            setBusy(false);
        }
    };

    const handleGrammarFix = async () => {
        if (isProcessing) return;
        const text = UI.inputText.value.trim();
        if (!text) return;

        lastRequest = { fn: handleGrammarFix, args: [] };
        setBusy(true);
        try {
            const response = await GrammarFlowAPI.request("/grammar-fix", {
                text,
                language: UI.languageSelect.value,
                humanize: UI.humanizeToggle.checked
            });
            renderResults(response.data);
        } catch (error) {
            renderError(error.message);
        } finally {
            setBusy(false);
        }
    };

    UI.rewriteBtn.addEventListener("click", handleRewrite);
    UI.fixGrammarBtn.addEventListener("click", handleGrammarFix);
});
