const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app-v16.js'), 'utf8');
const start = source.indexOf('class ShadowHighlighter');
const end = source.indexOf('\n}', start) + 2;
const ShadowHighlighter = vm.runInNewContext(`${source.slice(start, end)}; ShadowHighlighter`, {
    window: { getComputedStyle: () => ({}), addEventListener() {} }
});
const render = (text, highlights) => {
    const textarea = { value: text, addEventListener() {} }, overlay = { style: {}, innerHTML: '' };
    new ShadowHighlighter(textarea, overlay).setHighlights(highlights);
    return overlay.innerHTML;
};

test('highlights never match inside earlier highlight markup', () => {
    const html = render('I mark the class', [{ original: 'I mark', category: 'grammar' }, { original: 'class', category: 'tone' }, { original: 'mark' }]);
    assert.equal(html, '<mark class="highlight-grammar">I mark</mark> the <mark class="highlight-tone">class</mark>');
});

test('text with &, < and > is highlighted and stays escaped', () => {
    const html = render('Tom & Jerry <3', [{ original: 'Tom & Jerry', category: 'clarity' }, { original: '<3' }]);
    assert.equal(html, '<mark class="highlight-clarity">Tom &amp; Jerry</mark> <mark class="highlight-grammar">&lt;3</mark>');
});

test('AI text can never inject markup through the overlay', () => {
    const html = render('<img src=x onerror=alert(1)> hi', [{ original: '<img src=x onerror=alert(1)>', category: '"><script>' }]);
    assert.equal(html, '<mark class="highlight-grammar">&lt;img src=x onerror=alert(1)&gt;</mark> hi'); // unknown category falls back safely
});
