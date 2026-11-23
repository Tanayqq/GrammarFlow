const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tp = require('../public/teleprompter');

const page = () => {
    const dom = new JSDOM('<!doctype html><body><textarea id="inputText"></textarea><button id="teleprompterBtn">T</button></body>', { pretendToBeVisual: true });
    return { dom, doc: dom.window.document, win: dom.window };
};
// JSDOM has no layout, so give the scroll area a height to scroll through.
const withLayout = (handle, scrollHeight = 5000, clientHeight = 800) => {
    const stage = handle.overlay.querySelector('.tp-stage');
    Object.defineProperty(stage, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(stage, 'clientHeight', { value: clientHeight, configurable: true });
    return stage;
};
const key = (doc, k, target = doc.body) => {
    const ev = new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
};

test('scroll maths: speed is px per second and stops at the end', () => {
    assert.equal(tp.nextScroll(0, 60, 1000, 5000), 60);
    assert.equal(tp.nextScroll(100, 30, 500, 5000), 115);
    assert.equal(tp.nextScroll(4990, 60, 1000, 5000), 5000);
    assert.equal(tp.nextScroll(0, 60, 0, 5000), 0);
});

test('settings are clamped and unreadable values fall back to the defaults', () => {
    assert.deepEqual(tp.cleanSettings({ speed: 9999, size: 1, mirror: true }), { speed: 300, size: 24, mirror: true, theme: 'paper', line: true });
    assert.deepEqual(tp.cleanSettings({ speed: 'fast', size: null, mirror: 'yes' }), tp.DEFAULTS);
    assert.deepEqual(tp.cleanSettings(null), tp.DEFAULTS);
    assert.deepEqual(tp.cleanSettings(undefined), tp.DEFAULTS);
});

test('the overlay shows the text as plain text, never as HTML', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('Hello <img src=x onerror=alert(1)> world', doc);
    const text = h.overlay.querySelector('.tp-text');
    assert.equal(text.textContent, 'Hello <img src=x onerror=alert(1)> world');
    assert.equal(text.querySelector('img'), null);
    assert.equal(h.overlay.getAttribute('role'), 'dialog');
    assert.equal(h.overlay.getAttribute('aria-modal'), 'true');
    h.close();
});

test('empty text shows a hint and cannot be played', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('   ', doc);
    assert.match(h.overlay.querySelector('.tp-text').textContent, /Nothing to show yet/);
    h.toggle();
    assert.equal(h.state().playing, false);
    h.close();
});

test('play scrolls at the chosen speed, stops at the end and restarts from the top', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const h = tp.openTeleprompter('Line one.\nLine two.', doc);
    const stage = withLayout(h, 1000, 800); // 200 px to scroll
    h.setSpeed(100);
    h.toggle();
    t.mock.timers.tick(3000); // the countdown from the top
    assert.equal(h.state().playing, true);
    h.step(1000);
    assert.equal(h.state().pos, 100);
    assert.equal(stage.scrollTop, 100);
    h.step(5000);
    assert.equal(h.state().pos, 200);
    assert.equal(h.state().playing, false, 'stops at the end');
    assert.equal(h.overlay.querySelector('.tp-btn').textContent, 'Restart');
    h.toggle();
    assert.equal(h.state().pos, 0, 'Play at the end starts over');
    assert.equal(h.state().counting, 3, 'with the countdown, like any start from the top');
    t.mock.timers.tick(3000);
    assert.equal(h.state().playing, true);
    h.close();
});

test('keys: Space plays and pauses, arrows change speed, + and - change size, M mirrors, Esc closes', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const draft = doc.getElementById('inputText');
    draft.focus();
    const h = tp.openTeleprompter('Some words to read out loud.', doc);
    withLayout(h);
    key(doc, ' ');
    t.mock.timers.tick(3000);
    assert.equal(h.state().playing, true);
    key(doc, ' ');
    assert.equal(h.state().playing, false);
    const before = h.state();
    key(doc, 'ArrowUp');
    assert.equal(h.state().speed, before.speed + 10);
    key(doc, 'ArrowDown'); key(doc, 'ArrowDown');
    assert.equal(h.state().speed, before.speed - 10);
    key(doc, '+');
    assert.equal(h.state().size, before.size + 4);
    key(doc, '-'); key(doc, '-');
    assert.equal(h.state().size, before.size - 4);
    key(doc, 'm');
    assert.equal(h.state().mirror, true);
    assert.ok(h.overlay.querySelector('.tp-text').classList.contains('tp-mirror'));
    const esc = key(doc, 'Escape');
    assert.equal(esc.defaultPrevented, true);
    assert.equal(doc.querySelector('.tp'), null, 'overlay removed');
    assert.equal(doc.activeElement, draft, 'focus goes back to the draft');
    key(doc, ' '); // after closing, keys do nothing
});

test('speed and size never leave their limits', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('x', doc);
    h.setSpeed(-50); assert.equal(h.state().speed, 10);
    h.setSpeed(99999); assert.equal(h.state().speed, 300);
    h.setSize(0); assert.equal(h.state().size, 24);
    h.setSize(9999); assert.equal(h.state().size, 120);
    h.close();
});

test('a selection in the draft is read instead of the whole draft', () => {
    const { doc } = page();
    const ta = doc.getElementById('inputText');
    ta.value = 'First part. Second part.';
    assert.equal(tp.draftText(ta), 'First part. Second part.');
    ta.setSelectionRange(0, 11);
    assert.equal(tp.draftText(ta), 'First part.');
});

test('the Teleprompter button opens the draft, and the page ships the button and script', () => {
    const { doc } = page();
    doc.getElementById('inputText').value = 'Read me.';
    tp.init(doc);
    doc.getElementById('teleprompterBtn').click();
    assert.equal(doc.querySelector('.tp-text').textContent, 'Read me.');
    doc.querySelector('.tp-btn:last-child').click(); // Close
    assert.equal(doc.querySelector('.tp'), null);
    const html = readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
    assert.match(html, /id="teleprompterBtn"/);
    assert.match(html, /<script src="teleprompter\.js\?v=\d+"><\/script>/);
});

test('countdown: 3, 2, 1 on screen, then scrolling starts', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const h = tp.openTeleprompter('Read this.', doc);
    withLayout(h);
    const count = h.overlay.querySelector('.tp-count');
    assert.equal(count.getAttribute('aria-live'), 'assertive');
    h.toggle();
    assert.equal(count.textContent, '3');
    assert.equal(h.overlay.querySelector('.tp-btn').textContent, 'Cancel');
    assert.equal(h.state().playing, false, 'not scrolling during the countdown');
    t.mock.timers.tick(1000); assert.equal(count.textContent, '2');
    t.mock.timers.tick(1000); assert.equal(count.textContent, '1');
    h.step(5000); // a step during the countdown must not move the text
    assert.equal(h.state().pos, 0);
    t.mock.timers.tick(1000);
    assert.equal(count.textContent, '', 'number is cleared');
    assert.equal(h.state().playing, true);
    assert.equal(h.overlay.querySelector('.tp-btn').textContent, 'Pause');
    h.close();
});

test('countdown: Play again cancels it, Top and Close stop it, and resuming mid-text starts at once', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const h = tp.openTeleprompter('Read this.', doc);
    withLayout(h);
    h.toggle(); t.mock.timers.tick(1000);
    h.toggle(); // cancel
    assert.equal(h.state().counting, 0);
    t.mock.timers.tick(5000);
    assert.equal(h.state().playing, false, 'a cancelled countdown never starts the text');
    h.toggle(); h.reset(); // Top during a countdown
    t.mock.timers.tick(5000);
    assert.equal(h.state().playing, false);
    h.toggle(); t.mock.timers.tick(3000); // play from the top
    h.step(1000);
    h.toggle(); // pause mid-text
    assert.equal(h.state().playing, false);
    h.toggle(); // resume: no countdown
    assert.equal(h.state().counting, 0);
    assert.equal(h.state().playing, true);
    h.toggle(); h.reset(); h.toggle(); // counting again from the top
    assert.equal(h.state().counting, 3);
    h.close();
    t.mock.timers.tick(5000);
    assert.equal(h.state().playing, false, 'closing stops a running countdown');
});

// ---- pop-out window (floats over a video call) ----
const fakeWindow = () => {
    const w = new JSDOM('<!doctype html><head></head><body></body>', { pretendToBeVisual: true }).window;
    w.frames = 0;
    const raf = w.requestAnimationFrame.bind(w);
    w.requestAnimationFrame = cb => { w.frames++; return raf(cb); };
    return w;
};
const withApi = async (t, name, value, fn) => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, name);
    const old = globalThis[name];
    globalThis[name] = value;
    try { await fn(); } finally { if (had) globalThis[name] = old; else delete globalThis[name]; }
};
const pageWithStyles = () => {
    const p = page();
    const style = p.doc.createElement('style');
    style.textContent = '.tp { background: #000; } .tp-stage { overflow: auto; } .other { color: red; }';
    p.doc.head.appendChild(style);
    return p;
};
const popButton = h => [...h.overlay.querySelectorAll('.tp-btn')].find(b => b.textContent === 'Pop out' || b.textContent === 'Dock' || b.textContent === 'Not allowed');

test('Pop out moves the overlay into a floating window with its styles, and Dock brings it back', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    let asked;
    await withApi(t, 'documentPictureInPicture', { requestWindow: async opts => { asked = opts; return pip; } }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        withLayout(h);
        const popBtn = popButton(h);
        assert.match(popBtn.title, /Float over other windows/);
        await h.popOut();
        assert.equal(asked.width, 520);
        assert.equal(h.overlay.ownerDocument, pip.document, 'the overlay lives in the floating window now');
        assert.equal(doc.querySelector('.tp'), null, 'and is gone from the page');
        assert.equal(h.state().floating, true);
        assert.equal(popBtn.textContent, 'Dock');
        const css = [...pip.document.querySelectorAll('style')].map(x => x.textContent).join('');
        assert.match(css, /\.tp-stage/);
        assert.doesNotMatch(css, /\.other/, 'only the teleprompter rules are copied');
        assert.equal(pip.document.body.style.background, 'rgb(246, 245, 239)', 'paper colour until the stylesheet applies');
        assert.equal(pip.document.title, 'GrammarFlow Teleprompter');
        pip.document.body.dispatchEvent(new pip.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        assert.equal(h.state().counting, 3, 'Space in the floating window starts the countdown');
        h.dock();
        assert.equal(h.overlay.ownerDocument, doc, 'docked back into the page');
        assert.equal(h.state().floating, false);
        assert.equal(popBtn.textContent, 'Pop out');
        h.close();
    });
});

test('while floating, the scroll loop runs on the floating window, so it keeps going when the page is hidden', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        withLayout(h);
        h.toggle(); t.mock.timers.tick(3000);
        await h.popOut();
        assert.equal(h.state().playing, true, 'still playing after the move');
        assert.ok(pip.frames >= 1, 'the next frame is requested on the floating window');
        h.close();
    });
});

test('closing the floating window docks the teleprompter back where it was', async t => {
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        withLayout(h);
        h.setSpeed(100);
        await h.popOut();
        pip.dispatchEvent(new pip.Event('pagehide'));
        assert.equal(h.overlay.ownerDocument, doc);
        assert.equal(h.state().floating, false);
        assert.equal(h.state().speed, 100, 'settings survive');
        h.close();
    });
});

test('Close while floating closes the floating window too', async t => {
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    let closedCalls = 0;
    const realClose = pip.close.bind(pip);
    pip.close = () => { closedCalls++; realClose(); };
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        await h.popOut();
        h.close();
        assert.equal(closedCalls, 1);
        assert.equal(doc.querySelector('.tp'), null);
        assert.equal(h.overlay.isConnected, false);
    });
});

test('without Picture-in-Picture a separate window opens, and a blocked window says so', async t => {
    const { doc } = pageWithStyles();
    const win = fakeWindow();
    let opened;
    await withApi(t, 'open', (url, name, features) => { opened = { name, features }; return win; }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        assert.match(popButton(h).title, /own window/);
        await h.popOut();
        assert.equal(opened.name, 'gf-teleprompter');
        assert.match(opened.features, /popup=yes/);
        assert.equal(h.overlay.ownerDocument, win.document);
        h.close();
    });
    await withApi(t, 'open', () => null, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        await h.popOut();
        assert.equal(popButton(h).textContent, 'Not allowed');
        assert.equal(h.overlay.ownerDocument, doc, 'stays in the page');
        h.close();
    });
});

test('a window that arrives after the teleprompter was closed is closed again', async t => {
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    let closedCalls = 0;
    const realClose = pip.close.bind(pip);
    pip.close = () => { closedCalls++; realClose(); };
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        const pending = h.popOut();
        h.close();
        await pending;
        assert.equal(closedCalls, 1);
    });
});

test('Hide blanks everything at once and pauses; Show brings it back without resuming', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const h = tp.openTeleprompter('Private words.', doc);
    withLayout(h);
    h.toggle(); t.mock.timers.tick(3000);
    assert.equal(h.state().playing, true);
    h.toggleHidden();
    assert.equal(h.state().hidden, true);
    assert.equal(h.state().playing, false, 'pauses while hidden');
    assert.ok(h.overlay.classList.contains('tp-hidden'), 'the page CSS blanks everything under this class');
    assert.equal(doc.activeElement.className, 'tp-showbtn', 'focus moves to the small Show button');
    h.toggle();
    assert.equal(h.state().playing, false, 'Play does nothing while hidden');
    key(doc, ' ');
    key(doc, 'ArrowUp');
    assert.equal(h.state().playing, false, 'other keys are ignored while hidden');
    key(doc, 'h');
    assert.equal(h.state().hidden, false);
    assert.equal(h.overlay.classList.contains('tp-hidden'), false);
    assert.equal(h.state().playing, false, 'does not resume by itself');
    h.close();
});

test('H hides from the keyboard, and a countdown in progress is cancelled by Hide', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { doc } = page();
    const h = tp.openTeleprompter('Private words.', doc);
    withLayout(h);
    h.toggle();
    assert.equal(h.state().counting, 3);
    key(doc, 'H');
    assert.equal(h.state().hidden, true);
    assert.equal(h.state().counting, 0);
    t.mock.timers.tick(5000);
    assert.equal(h.state().playing, false, 'a cancelled countdown never starts the text');
    key(doc, 'Escape');
    assert.equal(doc.querySelector('.tp'), null, 'Escape still closes while hidden');
});

test('the floating window says when others could see it', async t => {
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Private words.', doc);
        const hint = h.overlay.querySelector('.tp-hint');
        assert.equal(hint.textContent, '', 'no note while it is in the page');
        assert.match(popButton(h).title, /Share a tab or a window/, 'the sharing advice is in the Pop out tooltip');
        await h.popOut();
        assert.match(hint.textContent, /unless you share your entire screen/);
        assert.equal(h.overlay.classList.contains('tp-floating'), true, 'the compact layout applies while floating');
        assert.ok(h.overlay.querySelectorAll('.tp-full-only').length >= 3, 'Top, Mirror and Dark are the ones dropped from the small bar');
        h.dock();
        assert.equal(hint.textContent, '');
        assert.equal(h.overlay.classList.contains('tp-floating'), false, 'back to the full layout when docked');
        h.close();
    });
});

test('theme: the site look by default, a dark forest variant on D or the button, remembered, never invalid', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('Some words.', doc);
    const themeBtn = [...h.overlay.querySelectorAll('.tp-btn')].find(b => b.textContent === 'Dark');
    assert.equal(h.state().theme, 'paper');
    assert.equal(h.overlay.classList.contains('tp-dark'), false);
    themeBtn.click();
    assert.equal(h.state().theme, 'forest');
    assert.equal(h.overlay.classList.contains('tp-dark'), true);
    assert.equal(themeBtn.textContent, 'Light');
    assert.equal(themeBtn.getAttribute('aria-pressed'), 'true');
    key(doc, 'd');
    assert.equal(h.state().theme, 'paper');
    key(doc, 'D');
    assert.equal(h.state().theme, 'forest');
    h.setTheme('purple');
    assert.equal(h.state().theme, 'paper', 'an unknown theme falls back to the site look');
    assert.equal(tp.cleanSettings({ theme: 'forest' }).theme, 'forest');
    assert.equal(tp.cleanSettings({ theme: 'neon' }).theme, 'paper');
    assert.ok(h.overlay.querySelector('.tp-primary'), 'Play is the one filled button');
    h.close();
});

test('the pop-out window also gets the fonts, and its page colour follows the theme', async t => {
    const { doc } = pageWithStyles();
    const fonts = doc.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Inter';
    doc.head.appendChild(fonts);
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Some words.', doc);
        h.setTheme('forest');
        await h.popOut();
        assert.ok(pip.document.querySelector('link[href*="fonts.googleapis.com"]'), 'Inter is loaded in the floating window');
        assert.equal(pip.document.body.style.background, 'rgb(23, 35, 29)');
        h.close();
    });
});

test('H hides even when the speed slider has focus, while the slider keeps its own arrow keys', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('Private words.', doc);
    const slider = h.overlay.querySelector('.tp-range');
    slider.focus();
    const arrow = key(doc, 'ArrowUp', slider);
    assert.equal(arrow.defaultPrevented, false, 'the slider handles its own arrow keys');
    assert.equal(h.state().speed, 60, 'and the teleprompter does not also change the speed');
    const hide = key(doc, 'h', slider);
    assert.equal(h.state().hidden, true, 'H still hides from the slider');
    assert.equal(hide.defaultPrevented, true);
    key(doc, 'H', doc.querySelector('.tp-showbtn'));
    assert.equal(h.state().hidden, false);
    h.close();
});

test('while floating, the page is free for typing; the shortcuts move with the overlay and come back on Dock', async t => {
    const { doc } = pageWithStyles();
    const typing = doc.getElementById('inputText');
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Read this out loud.', doc);
        const before = key(doc, ' ', typing);
        assert.equal(before.defaultPrevented, true, 'in the page the teleprompter owns Space (it is full-screen)');
        await h.popOut();
        for (const k of [' ', 'h', 'H', 'd', 'm', '+', '-']) {
            const ev = key(doc, k, typing);
            assert.equal(ev.defaultPrevented, false, `typing "${k}" in the page is left alone while floating`);
        }
        assert.equal(h.state().hidden, false, 'and nothing was triggered');
        const inPopup = pip.document.body.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
        assert.equal(inPopup, false, 'H in the floating window is handled');
        assert.equal(h.state().hidden, true);
        pip.document.body.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
        h.dock();
        assert.equal(key(doc, ' ', typing).defaultPrevented, true, 'docked: the shortcuts are back on the page');
        h.close();
        assert.equal(key(doc, ' ', typing).defaultPrevented, false, 'closed: nothing is left listening');
    });
});

test('the reading line can be switched off with the Line button or L, and the choice is remembered', () => {
    const { doc } = page();
    const h = tp.openTeleprompter('Some words.', doc);
    const lineBtn = [...h.overlay.querySelectorAll('.tp-btn')].find(b => b.textContent === 'Line');
    assert.equal(h.state().line, true, 'on by default');
    assert.equal(lineBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(h.overlay.classList.contains('tp-noline'), false);
    lineBtn.click();
    assert.equal(h.state().line, false);
    assert.equal(h.overlay.classList.contains('tp-noline'), true, 'the page CSS hides the line under this class');
    assert.equal(lineBtn.getAttribute('aria-pressed'), 'false');
    key(doc, 'l');
    assert.equal(h.state().line, true);
    key(doc, 'L');
    assert.equal(h.state().line, false);
    assert.equal(tp.cleanSettings({ line: false }).line, false);
    assert.equal(tp.cleanSettings({ line: 'no' }).line, true, 'anything but a real false keeps the line');
    assert.equal(tp.cleanSettings({}).line, true);
    assert.ok(lineBtn.classList.contains('tp-full-only'), 'dropped from the small floating bar, where L still works');
    h.close();
});

test('L does nothing while hidden, and the line setting survives docking', async t => {
    const { doc } = pageWithStyles();
    const pip = fakeWindow();
    await withApi(t, 'documentPictureInPicture', { requestWindow: async () => pip }, async () => {
        const h = tp.openTeleprompter('Some words.', doc);
        h.setLine(false);
        await h.popOut();
        assert.equal(h.overlay.classList.contains('tp-noline'), true, 'still off in the floating window');
        h.toggleHidden();
        pip.document.body.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
        assert.equal(h.state().line, false, 'L is ignored while hidden');
        h.toggleHidden();
        pip.document.body.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
        assert.equal(h.state().line, true, 'and works in the floating window otherwise');
        h.close();
    });
});
