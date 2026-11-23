const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const policy = () => {
    const config = JSON.parse(read('vercel.json'));
    const header = config.headers.flatMap(rule => rule.headers).find(h => h.key === 'Content-Security-Policy');
    return Object.fromEntries(header.value.split(';').map(part => part.trim()).filter(Boolean).map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
    }));
};
const pages = readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.html'));
const scripts = readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.js'));

test('the policy forbids inline and eval scripts, and closes forms, frames, plugins and the base tag', () => {
    const csp = policy();
    assert.ok(!csp['script-src'].includes("'unsafe-inline'"), 'inline scripts would let one injected tag run');
    assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'self'"]);
    assert.deepEqual(csp['form-action'], ["'self'"]);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
});

test('no page has an inline script, an inline event handler or a javascript: link', () => {
    for (const page of pages) {
        const html = read(`public/${page}`);
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
        assert.equal(inline.length, 0, `${page} has an inline <script>`);
        assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${page} has an inline event handler`);
        assert.doesNotMatch(html, /(href|src)\s*=\s*["']\s*javascript:/i, `${page} has a javascript: URL`);
    }
});

test('scripts do not build inline event handlers into the HTML they create', () => {
    for (const file of scripts) {
        const code = read(`public/${file}`);
        const found = code.match(/\son(click|change|input|submit|keydown|keyup|load|error|mouseover|mouseenter|focus|blur)\s*=\s*\\?["']/);
        assert.equal(found, null, `${file} writes an inline "${found && found[0].trim()}" handler`);
    }
});

test('scripts do not write inline <script> tags into popups or the page', () => {
    for (const file of scripts) {
        const code = readFileSync(path.join(root, 'public', file), 'utf8');
        assert.equal(/<script[\s>]/i.test(code), false, `${file} writes an inline <script> tag, which the policy blocks`);
    }
});

test('every script from another site is pinned by an integrity hash, except the Tailwind runtime', () => {
    for (const page of pages) {
        const tags = [...read(`public/${page}`).matchAll(/<script[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/gi)];
        for (const [tag, src] of tags) {
            if (/^https:\/\/cdn\.tailwindcss\.com/.test(src)) continue; // generated on the fly: it cannot be pinned
            assert.match(tag, /\sintegrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, `${page}: ${src} has no integrity hash`);
            assert.match(tag, /\scrossorigin="anonymous"/, `${page}: ${src} needs crossorigin for integrity checks`);
        }
    }
});

test('the Tailwind colors still load, now from a file instead of an inline script', () => {
    const config = read('public/tailwind-config.js');
    assert.match(config, /tailwind\.config\s*=/);
    assert.match(config, /cosmic/);
    assert.match(read('public/index.html'), /<script src="tailwind-config\.js"><\/script>/);
});
