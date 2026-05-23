let activeOverlay = null;
let activeTarget = null;
let activeSelectionRange = null;

const MIN_SELECTION_CHARS = 5;
const PDF_VIEWER_PREFIX = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

function isPdfViewerPage() {
    return location.href.startsWith(PDF_VIEWER_PREFIX);
}

// Listen for messages from background.js and popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const validActions = ["TRIGGER_REWRITE", "TRIGGER_GRAMMAR", "TRIGGER_SUMMARIZE", "TRIGGER_EXPLAIN"];

    if (validActions.includes(request.action)) {
        sendResponse({ received: true });
        handleActionRequest(request.action, request.selectionText);
    }
});

async function handleActionRequest(action, fallbackText) {
    activeTarget = document.activeElement;
    activeSelectionRange = null;

    // Prefer text passed from background (context menu / PDF API)
    let text = (fallbackText || "").trim();

    if (text.length < MIN_SELECTION_CHARS) {
        text = readDomSelection();
    }

    if (text.length < MIN_SELECTION_CHARS && isPdfViewerPage()) {
        text = await requestPdfSelectionFromBackground();
    }

    if (text.length < MIN_SELECTION_CHARS) {
        chrome.runtime.sendMessage({
            action: "NO_SELECTION",
            triggerAction: action,
            message: isPdfViewerPage()
                ? "Could not read PDF selection. Highlight text, then right-click and choose a GrammarFlow action."
                : "Please select at least a few words to process."
        });
        return;
    }

    // Map internal action to API endpoint
    const endpointMap = {
        "TRIGGER_REWRITE":   "/rewrite",
        "TRIGGER_GRAMMAR":   "/grammar-fix",
        "TRIGGER_SUMMARIZE": "/grammar-fix",
        "TRIGGER_EXPLAIN":   "/grammar-fix"
    };

    const labelMap = {
        "TRIGGER_REWRITE":   "Rewriting...",
        "TRIGGER_GRAMMAR":   "Fixing Grammar...",
        "TRIGGER_SUMMARIZE": "Summarizing...",
        "TRIGGER_EXPLAIN":   "Explaining..."
    };

    showOverlay(labelMap[action]);
    fetchResults(text, endpointMap[action], action);
}

function readDomSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
        let text = active.value.substring(active.selectionStart, active.selectionEnd);
        if (!text) text = active.value;
        return text.trim();
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        activeSelectionRange = selection.getRangeAt(0);
        return selection.toString().trim();
    }
    return "";
}

function requestPdfSelectionFromBackground() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "RESOLVE_SELECTION" }, (response) => {
            resolve((response && response.text) ? response.text.trim() : "");
        });
    });
}

function showOverlay(loadingText = "Processing...") {
    if (activeOverlay) activeOverlay.remove();

    activeOverlay = document.createElement('div');
    activeOverlay.id = 'gf-inline-overlay';
    
    activeOverlay.innerHTML = `
        <div id="gf-inline-header">
            <div class="gf-logo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                GrammarFlow
            </div>
            <div class="gf-close">&times;</div>
        </div>
        <div id="gf-inline-content">
            <div class="gf-loading-state">
                <div class="gf-spinner"></div>
                ${loadingText}
            </div>
        </div>
        <div id="gf-inline-footer" style="display: none;">
            <button class="gf-btn" id="gf-apply-btn" disabled>Apply</button>
        </div>
    `;

    document.body.appendChild(activeOverlay);
    positionOverlay();

    activeOverlay.querySelector('.gf-close').addEventListener('click', () => {
        activeOverlay.remove();
        activeOverlay = null;
    });
}

function positionOverlay() {
    const selection = window.getSelection();
    let rect;
    
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        rect = selection.getRangeAt(0).getBoundingClientRect();
    } else if (activeTarget) {
        rect = activeTarget.getBoundingClientRect();
    }

    if (rect) {
        const top = rect.bottom + window.scrollY + 10;
        const left = rect.left + window.scrollX;
        const maxLeft = window.innerWidth - 390;
        activeOverlay.style.top = `${top}px`;
        activeOverlay.style.left = `${Math.min(left, maxLeft)}px`;
    } else {
        activeOverlay.style.top = '20px';
        activeOverlay.style.right = '20px';
    }
}

function fetchResults(text, endpoint, triggerAction) {
    chrome.runtime.sendMessage({
        action: "API_CALL",
        endpoint: endpoint,
        payload: { text: text },
        triggerAction: triggerAction
    }, (response) => {
        const contentDiv = activeOverlay.querySelector('#gf-inline-content');
        
        if (!response || !response.success) {
            contentDiv.innerHTML = `<div class="gf-error">Connection failed. Please check your internet or try again.</div>`;
            return;
        }

        const data = response.data;
        if (!data || data.length === 0) {
            contentDiv.innerHTML = `<div class="gf-empty">No changes needed! Your text looks great.</div>`;
            return;
        }

        // Logic for different return types
        let results = [];
        if (Array.isArray(data)) {
            // /rewrite returns array of strings
            results = data.map((str, i) => ({
                text: str,
                label: i === 0 ? "Best Match" : `Alternative ${i}`,
                desc: "AI Rewrite"
            }));
        } else if (typeof data === 'string') {
            // Others return a single string
            results = [{
                text: data,
                label: endpoint === '/grammar-fix' ? "Corrected Version" : "AI Result",
                desc: "AI Result"
            }];
        }

        renderResults(results);
    });
}

let selectedResultText = "";

function renderResults(results) {
    const contentDiv = activeOverlay.querySelector('#gf-inline-content');
    const footerDiv = activeOverlay.querySelector('#gf-inline-footer');
    const applyBtn = activeOverlay.querySelector('#gf-apply-btn');
    
    contentDiv.innerHTML = "";
    footerDiv.style.display = "flex";

    results.forEach((res, index) => {
        const item = document.createElement('div');
        item.className = 'gf-result-item';
        
        item.innerHTML = `
            <div class="gf-result-badge">${res.label}</div>
            <div class="gf-result-text">${res.text}</div>
        `;

        item.addEventListener('click', () => {
            activeOverlay.querySelectorAll('.gf-result-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectedResultText = res.text;
            applyBtn.disabled = false;
        });

        contentDiv.appendChild(item);
        if (index === 0) item.click();
    });

    applyBtn.onclick = () => applyText(selectedResultText);
}

function applyText(newText) {
    if (!activeTarget) return;
    activeTarget.focus();

    if (activeTarget.tagName === "TEXTAREA" || activeTarget.tagName === "INPUT") {
        const start = activeTarget.selectionStart;
        const end = activeTarget.selectionEnd;
        activeTarget.setRangeText(newText, start, end, 'select');
        activeTarget.dispatchEvent(new Event('input', { bubbles: true }));
    } 
    else {
        if (activeSelectionRange) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(activeSelectionRange);
        }
        document.execCommand("insertText", false, newText);
    }

    if (activeOverlay) {
        activeOverlay.remove();
        activeOverlay = null;
    }
}
