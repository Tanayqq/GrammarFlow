const API_BASE = "https://grammarflow-brain.onrender.com/api/v1";
const WEB_APP_URL = "https://grammarflow-brain.onrender.com";

self.addEventListener("unhandledrejection", (event) => {
    console.error("[GrammarFlow] Unhandled rejection:", event.reason);
});

// ─────────────────────────────────────────────
// PROMPTS LIVE ON THE SERVER
// ─────────────────────────────────────────────
// The extension only tells the API which action it wants; the server picks
// the system prompt so the API cannot be used as a general-purpose LLM proxy.
const EXTENSION_ACTION_MAP = {
    TRIGGER_GRAMMAR:   "grammar",
    TRIGGER_SUMMARIZE: "summarize",
    TRIGGER_EXPLAIN:   "explain"
};

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
        handleApiCall(request.endpoint, request.payload, request.triggerAction)
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
function getExtensionAction(endpoint, triggerAction) {
    if (endpoint !== "/grammar-fix") return undefined;
    return EXTENSION_ACTION_MAP[triggerAction] || "grammar";
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

async function handleApiCall(endpoint, payload, triggerAction = null) {
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

    const body = {
        ...payload,
        language: lang,
        style,
        tone,
        humanize,
        extensionAction: getExtensionAction(endpoint, triggerAction)
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
