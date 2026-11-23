// Teleprompter: a full-screen, auto-scrolling reader for the draft (or just the selected part of it).
// Text is always inserted with textContent, never as HTML.
(function (root) {
    'use strict';

    const LIMITS = { speed: [10, 300], size: [24, 120] };
    const DEFAULTS = { speed: 60, size: 48, mirror: false };
    const KEY = 'gf_teleprompter';

    const clamp = (value, [lo, hi]) => Math.min(hi, Math.max(lo, value));
    // Pixels to scroll after dtMs at `speed` px per second, never past the end.
    const nextScroll = (top, speed, dtMs, max) => Math.min(max, top + (speed * dtMs) / 1000);

    const cleanSettings = raw => {
        const s = raw && typeof raw === 'object' ? raw : {};
        const num = (v, limits, fallback) => (Number.isFinite(v) ? clamp(Math.round(v), limits) : fallback);
        return { speed: num(s.speed, LIMITS.speed, DEFAULTS.speed), size: num(s.size, LIMITS.size, DEFAULTS.size), mirror: s.mirror === true };
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
        const speedLabel = el(doc, 'span', 'tp-value');
        const sizeLabel = el(doc, 'span', 'tp-value');
        const mirrorBtn = mk('Mirror', 'Flip the text left to right, for a prompter glass (M)', () => setMirror(!settings.mirror));
        const closeBtn = mk('Close', 'Close the teleprompter (Esc)', () => close());
        const speed = el(doc, 'input', 'tp-range');
        speed.type = 'range';
        speed.min = LIMITS.speed[0]; speed.max = LIMITS.speed[1]; speed.step = 5;
        speed.setAttribute('aria-label', 'Scroll speed');
        speed.oninput = () => setSpeed(Number(speed.value));
        bar.append(playBtn, mk('Top', 'Back to the start (Home)', () => reset()), el(doc, 'span', 'tp-gap'),
            mk('Slower', 'Slower (Arrow down)', () => setSpeed(settings.speed - 10)), speed,
            mk('Faster', 'Faster (Arrow up)', () => setSpeed(settings.speed + 10)), speedLabel,
            mk('A-', 'Smaller text (-)', () => setSize(settings.size - 4)), sizeLabel,
            mk('A+', 'Larger text (+)', () => setSize(settings.size + 4)), mirrorBtn, closeBtn);
        overlay.append(stage, line, bar);

        let playing = false;
        let pos = 0;
        let frame = 0;
        let last = 0;
        const raf = root.requestAnimationFrame ? cb => root.requestAnimationFrame(cb) : null;

        const maxScroll = () => Math.max(0, stage.scrollHeight - stage.clientHeight);
        const render = () => {
            speed.value = settings.speed;
            speedLabel.textContent = settings.speed + ' px/s';
            sizeLabel.textContent = settings.size + ' px';
            content.style.fontSize = settings.size + 'px';
            content.classList.toggle('tp-mirror', settings.mirror);
            mirrorBtn.setAttribute('aria-pressed', String(settings.mirror));
            playBtn.textContent = playing ? 'Pause' : (pos > 0 && pos >= maxScroll() ? 'Restart' : 'Play');
        };
        const setSpeed = v => { settings.speed = clamp(Math.round(v), LIMITS.speed); saveSettings(settings); render(); };
        const setSize = v => { settings.size = clamp(Math.round(v), LIMITS.size); saveSettings(settings); render(); };
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
            if (playing && raf) frame = raf(loop);
        };
        function toggle() {
            if (!body) return;
            if (!playing && pos >= maxScroll() && pos > 0) reset();
            playing = !playing;
            last = 0;
            render();
            if (playing && raf) frame = raf(loop);
        }
        function reset() { pos = 0; stage.scrollTop = 0; render(); }
        function close() {
            playing = false;
            if (frame && root.cancelAnimationFrame) root.cancelAnimationFrame(frame);
            doc.removeEventListener('keydown', onKey, true);
            if (doc.fullscreenElement && doc.exitFullscreen) { try { doc.exitFullscreen(); } catch (e) { /* already closed */ } }
            overlay.remove();
            if (previousFocus && previousFocus.focus) previousFocus.focus();
        }
        // If the reader scrolls by hand, continue from where they put it.
        stage.addEventListener('scroll', () => { if (Math.abs(stage.scrollTop - pos) > 2) pos = stage.scrollTop; });

        function onKey(e) {
            if (!overlay.isConnected) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' && e.key !== 'Escape') return; // the speed slider keeps its own arrow keys
            const keys = {
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

        doc.body.appendChild(overlay);
        if (overlay.requestFullscreen) { try { const p = overlay.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* the overlay already fills the page */ } }
        render();
        (body ? playBtn : closeBtn).focus();
        return { overlay, toggle, step, reset, close, setSpeed, setSize, setMirror, state: () => ({ ...settings, playing, pos }) };
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
