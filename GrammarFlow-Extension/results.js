const API_BASE = "https://grammarflow-brain.onrender.com/api/v1";

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = String(str || "");
    return d.innerHTML.replace(/\n/g, "<br>");
}

function setStatus(msg) {
    const el = document.getElementById("statusText");
    if (el) el.textContent = msg;
}

function renderError(msg) {
    document.getElementById("content").innerHTML =
        '<div class="result error-msg">' + escapeHtml(msg) + "</div>" +
        '<div class="actions"><button class="btn btn-secondary" id="closeBtn">Close</button></div>';
    document.getElementById("closeBtn").onclick = () => window.close();
}

function renderResults(results) {
    let html = "";
    if (!results || !results.length) {
        html = '<div class="empty-msg">No changes needed.</div>';
    } else {
        results.forEach((res) => {
            html += '<div class="result"><div class="result-label">' + escapeHtml(res.label) +
                "</div>" + escapeHtml(res.text) + "</div>";
        });
    }
    html += '<div class="actions">' +
        '<button class="btn btn-primary" id="copyBtn">Copy to Clipboard</button>' +
        '<button class="btn btn-secondary" id="closeBtn">Close</button></div>';
    document.getElementById("content").innerHTML = html;

    document.getElementById("closeBtn").onclick = () => window.close();
    document.getElementById("copyBtn").onclick = () => {
        const text = Array.from(document.querySelectorAll(".result"))
            .map((el) => el.innerText.trim())
            .filter(Boolean)
            .join("\n\n");
        navigator.clipboard.writeText(text).then(() => {
            document.getElementById("copyBtn").textContent = "Copied!";
        });
    };
}

function base64ToUtf8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function parseJob(params) {
    const err = params.get("err");
    if (err) return { error: err };

    const j = params.get("j");
    if (!j) {
        return { error: "Missing job data. Reload the extension at chrome://extensions (version 2.2)." };
    }
    try {
        return { job: JSON.parse(base64ToUtf8(j)) };
    } catch (e) {
        return { error: "Could not read your selection. Please try again." };
    }
}

function formatResults(data, label) {
    if (Array.isArray(data)) {
        return data.map((str, i) => ({
            text: str,
            label: i === 0 ? "Best Match" : "Alternative " + i
        }));
    }
    if (typeof data === "string") {
        return [{ text: data, label: label || "Result" }];
    }
    return null;
}

async function getOrCreateGuestSessionId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["guest_session_id"], (result) => {
            if (result.guest_session_id) {
                resolve(result.guest_session_id);
            } else {
                const uuid = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") 
                    ? crypto.randomUUID() 
                    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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

async function run() {
    const params = new URLSearchParams(location.search);
    const pageLabel = params.get("label") || "Result";
    document.getElementById("actionLabel").textContent = pageLabel;

    const parsed = parseJob(params);
    if (parsed.error) {
        renderError(parsed.error);
        return;
    }

    const job = parsed.job;
    setStatus("Calling GrammarFlow AI (up to 60s on first try)...");

    const guestSessionId = await getOrCreateGuestSessionId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(API_BASE + job.endpoint, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "x-guest-session-id": guestSessionId
            },
            body: JSON.stringify({
                text: job.text,
                language: job.language || "Auto",
                style: job.style || "Casual",
                tone: job.tone || "Friendly",
                humanize: job.humanize !== false
            }),
            signal: controller.signal
        });

        let json;
        try {
            json = await response.json();
        } catch {
            throw new Error("Server error (" + response.status + "). Try again.");
        }

        if (!response.ok) {
            throw new Error((json && json.error && json.error.message) || ("API error " + response.status));
        }
        if (!json.success || json.data == null) {
            throw new Error((json && json.error && json.error.message) || "No response from server.");
        }

        const results = formatResults(json.data, job.label || pageLabel);
        if (!results) throw new Error("Unexpected server response.");
        renderResults(results);
    } catch (e) {
        const msg = e.name === "AbortError"
            ? "Timed out. Server may be waking up — try again in 30 seconds."
            : (e.message || "Connection failed.");
        renderError(msg);
    } finally {
        clearTimeout(timer);
    }
}

window.addEventListener("error", (e) => {
    renderError("Script error: " + (e.message || "unknown"));
});

document.addEventListener("DOMContentLoaded", run);
