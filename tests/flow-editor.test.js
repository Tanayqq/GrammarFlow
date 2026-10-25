const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const path = require('node:path');

async function flowEditor(t, response) {
    const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
    const dom = new JSDOM(read('public/editor.html'), { url: 'https://grammarflow.example/editor.html',
        runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window;
    await new Promise(resolve => setImmediate(resolve));
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLElement.prototype.scrollTo = () => {};
    w.fetch = async (url, options) => ({ ok: true, json: async () => response(url, options) });
    w.eval(read('public/editor.js') + '\nwindow.flowTest = { API, esc };');
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    return w;
}

test('flow editor waits for a queued grammar result instead of displaying an empty result', async t => {
    const w = await flowEditor(t, url => url.includes('/job/')
        ? { success: true, data: { status: 'completed', result: 'She goes to school.' } }
        : { success: true, data: { status: 'queued', jobId: 'synthetic-job' } });
    const result = await w.flowTest.API.call('/grammar-fix', { text: 'She go to school.' });
    assert.equal(result.data[0], 'She goes to school.');
});

test('flow editor safely preserves quotes in rewrite data attributes', async t => {
    const w = await flowEditor(t, () => ({ success: true, data: [] }));
    const value = 'Hello " onfocus="alert(1)';
    const output = w.document.createElement('div');
    output.innerHTML = `<div data-rw="${w.flowTest.esc(value)}"></div>`;
    assert.equal(output.firstChild.dataset.rw, value);
    assert.equal(output.querySelector('[onfocus]'), null);
});

test('guest requests work when randomUUID is unavailable', async t => {
    const w = await flowEditor(t, () => ({ success: true, data: ['A rewrite.'] }));
    Object.defineProperty(w.crypto, 'randomUUID', { value: undefined });
    await w.flowTest.API.call('/rewrite', { text: 'A short sentence.' });
    assert.match(w.localStorage.getItem('guest_session_id'), /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});
