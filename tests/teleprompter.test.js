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
    assert.deepEqual(tp.cleanSettings({ speed: 9999, size: 1, mirror: true }), { speed: 300, size: 24, mirror: true });
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
