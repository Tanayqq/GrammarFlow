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

function removeOverlay() {
    if (activeOverlay) {
        activeOverlay.remove();
        activeOverlay = null;
        window.removeEventListener('scroll', positionOverlay, { capture: true, passive: true });
        window.removeEventListener('resize', positionOverlay);
    }
}

function showOverlay(loadingText = "Processing...") {
    removeOverlay();

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

    // Dynamically adjust positioning on window scroll (including custom containers via capture phase) and resize
    window.addEventListener('scroll', positionOverlay, { capture: true, passive: true });
    window.addEventListener('resize', positionOverlay);

    activeOverlay.querySelector('.gf-close').addEventListener('click', () => {
        removeOverlay();
    });
}

function positionOverlay() {
    if (!activeOverlay) return;

    const selection = window.getSelection();
    let rect;
    
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        rect = selection.getRangeAt(0).getBoundingClientRect();
    } else if (activeTarget) {
        rect = activeTarget.getBoundingClientRect();
    }

    if (rect) {
        // Explicitly set absolute positioning relative to the document
        activeOverlay.style.position = 'absolute';
        
        const overlayWidth = activeOverlay.offsetWidth || 380;
        const overlayHeight = activeOverlay.offsetHeight || 160;
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate initial horizontal position (fit inside viewport)
        let left = rect.left + window.scrollX;
        
        // Calculate initial vertical position (lift up if needed)
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        let top;
        if (spaceBelow >= overlayHeight + 15 || spaceBelow >= spaceAbove) {
            // Put below the element
            top = rect.bottom + window.scrollY + 10;
        } else {
            // Put above the element (lift up)
            top = rect.top + window.scrollY - overlayHeight - 10;
        }
        
        // --- VIEWPORT CLAMPING (BULLETPROOF SAFETY NET) ---
        // Convert document-relative positions back to viewport-relative positions for clamping
        let viewportTop = top - window.scrollY;
        let viewportLeft = left - window.scrollX;
        
        // Clamp viewportTop to be fully visible within the viewport (with 12px margin)
        const maxViewportTop = Math.max(12, viewportHeight - overlayHeight - 12);
        viewportTop = Math.max(12, Math.min(viewportTop, maxViewportTop));
        
        // Clamp viewportLeft to be fully visible within the viewport (with 12px margin)
        const maxViewportLeft = Math.max(12, viewportWidth - overlayWidth - 12);
        viewportLeft = Math.max(12, Math.min(viewportLeft, maxViewportLeft));
        
        // Convert back to document-relative coordinates
        top = viewportTop + window.scrollY;
        left = viewportLeft + window.scrollX;
        
        activeOverlay.style.top = `${top}px`;
        activeOverlay.style.left = `${left}px`;
        activeOverlay.style.right = 'auto';
    } else {
        // Fallback to top-right viewport corner if no selection/target is found
        activeOverlay.style.position = 'fixed';
        activeOverlay.style.top = '20px';
        activeOverlay.style.right = '20px';
        activeOverlay.style.left = 'auto';
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
            positionOverlay();
            return;
        }

        const data = response.data;
        
        // If the backend has queued the task, poll until completed
        if (data && data.status === "queued" && data.jobId) {
            pollJob(data.jobId, endpoint, triggerAction);
            return;
        }

        processAndRenderResponseData(data, endpoint);
    });
}

function pollJob(jobId, originalEndpoint, triggerAction) {
    const contentDiv = activeOverlay.querySelector('#gf-inline-content');
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds timeout (40 * 1.5s)
    
    const interval = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(interval);
            contentDiv.innerHTML = `<div class="gf-error">Request timed out. Please try again.</div>`;
            positionOverlay();
            return;
        }
        
        chrome.runtime.sendMessage({
            action: "API_CALL",
            endpoint: `/job/${jobId}`,
            payload: {},
            triggerAction: triggerAction
        }, (response) => {
            if (!activeOverlay) {
                // Stop polling if the overlay was closed by the user
                clearInterval(interval);
                return;
            }

            if (response && response.success) {
                const jobData = response.data;
                if (jobData && jobData.status === "completed") {
                    clearInterval(interval);
                    processAndRenderResponseData(jobData.result, originalEndpoint);
                } else if (jobData && jobData.status === "failed") {
                    clearInterval(interval);
                    const errMsg = (response.error && response.error.message) || "Job failed in background worker.";
                    contentDiv.innerHTML = `<div class="gf-error">${errMsg}</div>`;
                    positionOverlay();
                }
                // Keep polling if status is 'active' or 'queued'
            } else {
                clearInterval(interval);
                const errMsg = (response && response.error && response.error.message) || "Failed to retrieve status.";
                contentDiv.innerHTML = `<div class="gf-error">${errMsg}</div>`;
                positionOverlay();
            }
        });
    }, 1500);
}

function processAndRenderResponseData(data, endpoint) {
    const contentDiv = activeOverlay.querySelector('#gf-inline-content');
    
    if (!data || data.length === 0) {
        contentDiv.innerHTML = `<div class="gf-empty">No changes needed! Your text looks great.</div>`;
        positionOverlay();
        return;
    }

    // Logic for different return types
    let results = [];
    
    // If the backend wrapped the combined string in an array of length 1, extract it
    if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'string') {
        data = data[0];
    }
    
    // Split the string if it contains any of the known separators
    if (typeof data === 'string' && (data.includes('===_SEPARATOR===') || data.includes('===REWRITE_SEPARATOR==='))) {
        data = data.split(/===_SEPARATOR===|===REWRITE_SEPARATOR===/).map(s => s.trim()).filter(Boolean);
    }

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
    
    // Reposition the overlay to adjust to the new size after results are rendered
    positionOverlay();
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

    removeOverlay();
}
