// Teleprompter: a full-screen, auto-scrolling reader for the draft (or just the selected part of it).
// Text is always inserted with textContent, never as HTML.
(function (root) {
    'use strict';

    const LIMITS = { speed: [10, 300], size: [24, 120] };
    const DEFAULTS = { speed: 60, size: 48, mirror: false, theme: 'paper', line: true }; // paper = the site's look, forest = dark
    const COUNTDOWN = 3; // seconds shown before scrolling starts from the top
    const KEY = 'gf_teleprompter';

    const clamp = (value, [lo, hi]) => Math.min(hi, Math.max(lo, value));
    // Pixels to scroll after dtMs at `speed` px per second, never past the end.
    const nextScroll = (top, speed, dtMs, max) => Math.min(max, top + (speed * dtMs) / 1000);

    const cleanSettings = raw => {
        const s = raw && typeof raw === 'object' ? raw : {};
        const num = (v, limits, fallback) => (Number.isFinite(v) ? clamp(Math.round(v), limits) : fallback);
        return { speed: num(s.speed, LIMITS.speed, DEFAULTS.speed), size: num(s.size, LIMITS.size, DEFAULTS.size), mirror: s.mirror === true, theme: s.theme === 'forest' ? 'forest' : 'paper', line: s.line !== false };
    };
    const loadSettings = () => {
        try { return cleanSettings(JSON.parse(root.localStorage.getItem(KEY))); } catch (e) { return { ...DEFAULTS }; }
    };
    const saveSettings = s => { try { root.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: settings just won't persist */ } };

    const el = (doc, tag, cls, text) => {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    // A pop-out window starts with no CSS: copy over only the teleprompter rules.
    const copyStyles = (from, to) => {
        for (const sheet of from.styleSheets) {
            let css = '';
            try {
                for (const rule of sheet.cssRules) if (/\.tp(?![A-Za-z0-9_])/.test(rule.cssText)) css += rule.cssText + '\n';
            } catch (e) { /* a cross-origin sheet cannot be read and has no teleprompter rules */ }
            if (css) { const st = to.createElement('style'); st.textContent = css; to.head.appendChild(st); }
        }
        for (const link of from.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]')) to.head.appendChild(link.cloneNode());
    };

    function openTeleprompter(text, doc = root.document) {
        const settings = loadSettings();
        const previousFocus = doc.activeElement;
        const body = String(text || '').trim();

        const overlay = el(doc, 'div', 'tp');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Teleprompter');

        const stage = el(doc, 'div', 'tp-stage');
        stage.tabIndex = 0;
        const content = el(doc, 'div', 'tp-text', body || 'Nothing to show yet. Type or dictate in the draft first.');
        stage.appendChild(content);
        const line = el(doc, 'div', 'tp-line');
        line.setAttribute('aria-hidden', 'true');

        const bar = el(doc, 'div', 'tp-bar');
        const mk = (label, title, onClick) => {
            const b = el(doc, 'button', 'tp-btn', label);
            b.type = 'button';
            b.title = title;
            b.onclick = onClick;
            return b;
        };
        const playBtn = mk('Play', 'Start or pause (Space)', () => toggle());
        playBtn.classList.add('tp-primary');
        const speedLabel = el(doc, 'span', 'tp-value');
        const sizeLabel = el(doc, 'span', 'tp-value');
        const mirrorBtn = mk('Mirror', 'Flip the text left to right, for a prompter glass (M)', () => setMirror(!settings.mirror));
        const hideBtn = mk('Hide', 'Blank the teleprompter instantly, for example when you start sharing your screen (H)', () => toggleHidden());
        const themeBtn = mk('Dark', '', () => setTheme(settings.theme === 'forest' ? 'paper' : 'forest'));
        themeBtn.classList.add('tp-full-only');
        mirrorBtn.classList.add('tp-full-only');
        const lineBtn = mk('Line', 'Show or hide the reading line (L)', () => setLine(!settings.line));
        lineBtn.classList.add('tp-full-only');
        const popBtn = mk('Pop out', '', () => popOut());
        const closeBtn = mk('Close', 'Close the teleprompter (Esc)', () => close());
        const speed = el(doc, 'input', 'tp-range');
        speed.type = 'range';
        speed.min = LIMITS.speed[0]; speed.max = LIMITS.speed[1]; speed.step = 5;
        speed.setAttribute('aria-label', 'Scroll speed');
        speed.oninput = () => setSpeed(Number(speed.value));
        bar.append(playBtn, (() => { const b = mk('Top', 'Back to the start (Home)', () => reset()); b.classList.add('tp-full-only'); return b; })(), el(doc, 'span', 'tp-gap'),
            mk('Slower', 'Slower (Arrow down)', () => setSpeed(settings.speed - 10)), speed,
            mk('Faster', 'Faster (Arrow up)', () => setSpeed(settings.speed + 10)), speedLabel,
            mk('A-', 'Smaller text (-)', () => setSize(settings.size - 4)), sizeLabel,
            mk('A+', 'Larger text (+)', () => setSize(settings.size + 4)), mirrorBtn, lineBtn, themeBtn, popBtn, hideBtn, closeBtn);
        const countEl = el(doc, 'div', 'tp-count');
        countEl.setAttribute('aria-live', 'assertive');
        const hint = el(doc, 'div', 'tp-hint');
        hint.setAttribute('role', 'note');
        const showBtn = el(doc, 'button', 'tp-showbtn', 'Show (H)');
        showBtn.type = 'button';
        showBtn.title = 'Show the teleprompter again (H)';
        showBtn.onclick = () => toggleHidden();
        overlay.append(stage, line, countEl, hint, bar, showBtn);

        let playing = false;
        let counting = 0; // seconds left in the countdown, 0 when none
        let countTimer = 0;
        let pos = 0;
        let frame = 0;
        let last = 0;
        let host = root; // the window showing the overlay: the page, or the pop-out window
        let popup = null;
        let floating = false;
        let closed = false;
        let hidden = false;
        const schedule = cb => { const w = host.requestAnimationFrame ? host : root; return w.requestAnimationFrame ? w.requestAnimationFrame(cb) : 0; };
        const cancelFrame = () => {
            if (!frame) return;
            const w = host.cancelAnimationFrame ? host : root;
            if (w.cancelAnimationFrame) w.cancelAnimationFrame(frame);
            frame = 0;
        };

        const maxScroll = () => Math.max(0, stage.scrollHeight - stage.clientHeight);
        const render = () => {
            speed.value = settings.speed;
            speedLabel.textContent = settings.speed + ' px/s';
            sizeLabel.textContent = settings.size + ' px';
            content.style.fontSize = settings.size + 'px';
            content.classList.toggle('tp-mirror', settings.mirror);
            mirrorBtn.setAttribute('aria-pressed', String(settings.mirror));
            hint.textContent = floating ? 'Only you see this window, unless you share your entire screen.' : '';
            overlay.classList.toggle('tp-floating', floating);
            overlay.classList.toggle('tp-hidden', hidden);
            overlay.classList.toggle('tp-noline', !settings.line);
            lineBtn.setAttribute('aria-pressed', String(settings.line));
            const dark = settings.theme === 'forest';
            overlay.classList.toggle('tp-dark', dark);
            themeBtn.textContent = dark ? 'Light' : 'Dark';
            themeBtn.title = dark ? 'Switch to the light page (D)' : 'Switch to a dark page, easier in a dim room (D)';
            themeBtn.setAttribute('aria-pressed', String(dark));
            hideBtn.textContent = hidden ? 'Show' : 'Hide';
            popBtn.textContent = floating ? 'Dock' : 'Pop out';
            popBtn.title = floating ? 'Bring the teleprompter back into the page'
                : root.documentPictureInPicture ? 'Float over other windows, such as a video call. Share a tab or a window, not your whole screen, to keep it private.'
                : 'Open in its own window, to place beside a video call';
            playBtn.textContent = counting ? 'Cancel' : playing ? 'Pause' : (pos > 0 && pos >= maxScroll() ? 'Restart' : 'Play');
        };
        const setSpeed = v => { settings.speed = clamp(Math.round(v), LIMITS.speed); saveSettings(settings); render(); };
        const setSize = v => { settings.size = clamp(Math.round(v), LIMITS.size); saveSettings(settings); render(); };
        const setLine = v => { settings.line = Boolean(v); saveSettings(settings); render(); };
        const setTheme = v => { settings.theme = v === 'forest' ? 'forest' : 'paper'; saveSettings(settings); render(); };
        const setMirror = v => { settings.mirror = Boolean(v); saveSettings(settings); render(); };

        // One animation step: scroll by dtMs worth of speed; stop at the end.
        const step = dtMs => {
            if (!playing) return;
            pos = nextScroll(pos, settings.speed, dtMs, maxScroll());
            stage.scrollTop = pos;
            if (pos >= maxScroll()) { playing = false; render(); }
        };
        const loop = now => {
            if (!playing) return;
            step(last ? now - last : 0);
            last = now;
            if (playing) frame = schedule(loop);
        };
        const stopCount = () => {
            if (countTimer) root.clearInterval(countTimer);
            countTimer = 0; counting = 0; countEl.textContent = '';
        };
        const startPlaying = () => { playing = true; last = 0; render(); frame = schedule(loop); };
        const startCount = () => {
            counting = COUNTDOWN;
            countEl.textContent = String(counting);
            render();
            countTimer = root.setInterval(() => {
                if (!counting) return; // a stray tick after Cancel, Top or Close must not start the text
                counting -= 1;
                if (counting > 0) { countEl.textContent = String(counting); return; }
                stopCount();
                startPlaying();
            }, 1000);
        };
        // Play from the top counts down first; Play again during the countdown cancels it; resuming mid-text starts at once.
        function toggle() {
            if (!body || hidden) return;
            if (counting) { stopCount(); render(); return; }
            if (playing) { playing = false; render(); return; }
            if (pos >= maxScroll() && pos > 0) reset();
            if (pos === 0) startCount(); else startPlaying();
        }
        // Panic button: blank everything and pause, so no line is lost while hidden. Showing does not resume by itself.
        function toggleHidden() {
            hidden = !hidden;
            if (hidden) { stopCount(); playing = false; cancelFrame(); }
            render();
            (hidden ? showBtn : stage).focus();
        }
        function reset() { stopCount(); pos = 0; stage.scrollTop = 0; render(); }
        function close() {
            closed = true;
            stopCount();
            playing = false;
            cancelFrame();
            doc.removeEventListener('keydown', onKey, true);
            if (popup) {
                try { popup.document.removeEventListener('keydown', onKey, true); popup.removeEventListener('pagehide', dock); popup.close(); } catch (e) { /* window already gone */ }
                popup = null; floating = false; host = root;
            }
            if (doc.fullscreenElement && doc.exitFullscreen) { try { doc.exitFullscreen(); } catch (e) { /* already closed */ } }
            overlay.remove();
            if (previousFocus && previousFocus.focus) previousFocus.focus();
        }
        // If the reader scrolls by hand, continue from where they put it.
        stage.addEventListener('scroll', () => { if (Math.abs(stage.scrollTop - pos) > 2) pos = stage.scrollTop; });

        function onKey(e) {
            if (!overlay.isConnected) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' && /^(Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down))$/.test(e.key)) return; // the speed slider keeps its own navigation keys
            if (hidden && e.key !== 'h' && e.key !== 'H' && e.key !== 'Escape') return;
            const keys = {
                h: toggleHidden, H: toggleHidden,
                l: () => setLine(!settings.line), L: () => setLine(!settings.line),
                d: () => setTheme(settings.theme === 'forest' ? 'paper' : 'forest'), D: () => setTheme(settings.theme === 'forest' ? 'paper' : 'forest'),
                ' ': toggle, Escape: close, Home: reset,
                ArrowUp: () => setSpeed(settings.speed + 10), ArrowDown: () => setSpeed(settings.speed - 10),
                '+': () => setSize(settings.size + 4), '=': () => setSize(settings.size + 4), '-': () => setSize(settings.size - 4),
                m: () => setMirror(!settings.mirror), M: () => setMirror(!settings.mirror)
            };
            if (!keys[e.key]) return;
            if (e.target && e.target.tagName === 'BUTTON' && e.key === ' ') return; // a focused button handles Space itself
            e.preventDefault();
            e.stopPropagation();
            keys[e.key]();
        }
        doc.addEventListener('keydown', onKey, true);

        // Pop out: Chrome and Edge give a window that floats above every other window (Document Picture-in-Picture), so it stays on
        // top of a video call. Other browsers get a small separate window to place beside the call.
        async function popOut() {
            if (floating) { dock(); return; }
            let w = null;
            try {
                w = root.documentPictureInPicture
                    ? await root.documentPictureInPicture.requestWindow({ width: 520, height: 380 })
                    : (root.open ? root.open('', 'gf-teleprompter', 'popup=yes,width=520,height=380') : null);
            } catch (e) { w = null; }
            if (w && closed) { try { w.close(); } catch (e) { /* ignore */ } return; }
            if (!w) { popBtn.textContent = 'Not allowed'; root.setTimeout(render, 2000); return; }
            copyStyles(doc, w.document);
            w.document.title = 'GrammarFlow Teleprompter';
            w.document.body.style.margin = '0';
            w.document.body.style.background = settings.theme === 'forest' ? '#17231d' : '#f6f5ef';
            cancelFrame();
            popup = w; host = w; floating = true;
            doc.removeEventListener('keydown', onKey, true); // the page is free for typing again while the teleprompter floats
            w.document.addEventListener('keydown', onKey, true);
            w.addEventListener('pagehide', dock);
            w.document.body.appendChild(overlay);
            stage.scrollTop = pos; // moving the element resets its scroll
            if (playing) { last = 0; frame = schedule(loop); }
            render();
            stage.focus();
        }
        // Back into the page, also what happens when the pop-out window is closed.
        function dock() {
            if (!floating) return;
            const w = popup;
            cancelFrame();
            floating = false; popup = null; host = root;
            try { w.document.removeEventListener('keydown', onKey, true); w.removeEventListener('pagehide', dock); } catch (e) { /* ignore */ }
            if (!closed) {
                doc.addEventListener('keydown', onKey, true);
                doc.body.appendChild(overlay);
                stage.scrollTop = pos;
                if (playing) { last = 0; frame = schedule(loop); }
            }
            try { if (w && !w.closed) w.close(); } catch (e) { /* ignore */ }
            render();
        }

        doc.body.appendChild(overlay);
        if (overlay.requestFullscreen) { try { const p = overlay.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* the overlay already fills the page */ } }
        render();
        (body ? playBtn : closeBtn).focus();
        return { overlay, toggle, step, reset, close, setSpeed, setSize, setMirror, popOut, dock, toggleHidden, setTheme, setLine, state: () => ({ ...settings, playing, counting, floating, hidden, pos }) };
    }

    // Selected text in the draft if there is a selection, otherwise the whole draft.
    const draftText = ta => (ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value);

    function init(doc = root.document) {
        const btn = doc.getElementById('teleprompterBtn');
        const draft = doc.getElementById('inputText');
        if (btn && draft) btn.onclick = () => openTeleprompter(draftText(draft), doc);
    }

    const api = { LIMITS, DEFAULTS, clamp, nextScroll, cleanSettings, openTeleprompter, draftText, init };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root.document) {
        root.GFTeleprompter = api;
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => init());
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
