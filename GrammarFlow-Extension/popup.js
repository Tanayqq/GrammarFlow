const WEB_APP_URL = "https://grammarflowt.vercel.app";

document.addEventListener('DOMContentLoaded', () => {
    // ── Element refs ─────────────────────────
    const langSelect      = document.getElementById('langSelect');
    const styleSelect     = document.getElementById('styleSelect');
    const toneSelect      = document.getElementById('toneSelect');
    const humanizeToggle  = document.getElementById('humanizeToggle');
    const saveBtn         = document.getElementById('saveBtn');
    const saveStatus      = document.getElementById('saveStatus');
    const actionStatus    = document.getElementById('action-status');

    // ── Load saved settings ───────────────────
    chrome.storage.sync.get({
        language: 'Auto',
        style: 'Casual',
        tone: 'Friendly',
        humanize: true
    }, (prefs) => {
        langSelect.value     = prefs.language;
        styleSelect.value    = prefs.style;
        toneSelect.value     = prefs.tone;
        humanizeToggle.checked = prefs.humanize;
    });

    // ── Save settings ─────────────────────────
    saveBtn.addEventListener('click', () => {
        const prefs = {
            language: langSelect.value,
            style:    styleSelect.value,
            tone:     toneSelect.value,
            humanize: humanizeToggle.checked
        };
        chrome.storage.sync.set(prefs, () => {
            saveStatus.textContent = '✓ Saved';
            saveStatus.classList.add('visible');
            setTimeout(() => saveStatus.classList.remove('visible'), 2000);
        });
    });

    // ── Helper: show status message ───────────
    function showStatus(msg, isError = false) {
        actionStatus.textContent = msg;
        actionStatus.className = 'action-status ' + (isError ? 'error' : 'success');
        setTimeout(() => { actionStatus.className = 'action-status hidden'; }, 3500);
    }

    // ── Helper: trigger action on active tab ──
    function triggerTabAction(action) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) { showStatus('No active tab found.', true); return; }
            chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script not available (PDF, restricted page, etc.)
                    // Tell background to handle it via fallback popup
                    chrome.runtime.sendMessage({ action: 'FALLBACK_ACTION', triggerAction: action, tabId: tabs[0].id }, () => {
                        showStatus('Opening results window...');
                        setTimeout(() => window.close(), 500);
                    });
                } else {
                    showStatus('Processing...');
                    window.close(); // Close popup so overlay is visible
                }
            });
        });
    }

    // ── Quick Action Buttons ──────────────────
    document.getElementById('btn-rewrite').addEventListener('click',   () => triggerTabAction('TRIGGER_REWRITE'));
    document.getElementById('btn-grammar').addEventListener('click',   () => triggerTabAction('TRIGGER_GRAMMAR'));
    document.getElementById('btn-summarize').addEventListener('click', () => triggerTabAction('TRIGGER_SUMMARIZE'));
    document.getElementById('btn-explain').addEventListener('click',   () => triggerTabAction('TRIGGER_EXPLAIN'));

    // ── Launcher Buttons ──────────────────────
    document.getElementById('btn-docai').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_TAB', url: WEB_APP_URL });
        window.close();
    });
    document.getElementById('btn-dashboard').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_TAB', url: WEB_APP_URL });
        window.close();
    });
});
