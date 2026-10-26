const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
test('analytics requires consent and emits only fixed feature names and sanitized page data', () => {
    const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
        url: 'https://grammarflow.example/?email=private@example.com#secret', runScripts: 'outside-only'
    });
    try {
        const w = dom.window;
        w.eval(readFileSync('public/analytics.js', 'utf8'));
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
        assert.equal(w.document.querySelector('script[src*="googletagmanager"]'), null);
        w.document.getElementById('declineAnalyticsBtn').click();
        assert.equal(w.document.querySelector('script[src*="googletagmanager"]'), null);
        w.document.getElementById('analyticsPreferencesBtn').click();
        assert.equal(w.document.getElementById('analyticsConsent').hidden, false);
        w.document.getElementById('acceptAnalyticsBtn').click();
        assert.equal(w.document.querySelectorAll('script[src*="googletagmanager"]').length, 1);
        w.document.getElementById('inputText').value = 'Private writing never sent to analytics';
        w.document.getElementById('fixGrammarBtn').click();
        const calls = w.dataLayer.map(args => [...args]);
        assert.ok(calls.some(args => args[0] === 'event' && args[1] === 'feature_clicked' && args[2].feature === 'grammar'));
        assert.ok(calls.some(args => args[0] === 'event' && args[1] === 'page_view' && args[2].page_location === 'https://grammarflow.example/'));
        assert.doesNotMatch(JSON.stringify(calls), /private@example|#secret|Private writing/);
    } finally { dom.window.close(); }
});
