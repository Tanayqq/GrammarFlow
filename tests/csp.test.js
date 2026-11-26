const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const policy = () => {
    const config = JSON.parse(read('vercel.json'));
    // the site-wide rule, not the one for the Python sandbox page
    const header = config.headers.find(rule => rule.source.startsWith('/((?!')).headers.find(h => h.key === 'Content-Security-Policy');
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
        // type="application/ld+json" is data for search engines: browsers never run it
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/gi)];
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

test('every script from another site is pinned by an integrity hash', () => {
    for (const page of pages) {
        const tags = [...read(`public/${page}`).matchAll(/<script[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/gi)];
        for (const [tag, src] of tags) {
            assert.match(tag, /\sintegrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, `${page}: ${src} has no integrity hash`);
            assert.match(tag, /\scrossorigin="anonymous"/, `${page}: ${src} needs crossorigin for integrity checks`);
        }
    }
});

test('Tailwind is built ahead of time: no runtime script, no CDN in the policy, colors present in the built file', () => {
    const html = read('public/index.html');
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind-config\.js/);
    assert.match(html, /<link rel="stylesheet" href="tailwind\.css/);
    assert.doesNotMatch(read('vercel.json'), /cdn\.tailwindcss\.com/);
    assert.match(read('public/tailwind.css'), /cosmic|#080312/i);
});

test('public/tailwind.css is up to date with the classes the pages use', () => {
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const fs = require('node:fs');
    const out = path.join(os.tmpdir(), `tailwind-check-${process.pid}.css`);
    const bin = path.join(__dirname, '..', 'node_modules', 'tailwindcss', 'lib', 'cli.js');
    execFileSync(process.execPath, [bin, '-i', 'tailwind.input.css', '-o', out, '--minify'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    const rebuilt = fs.readFileSync(out, 'utf8');
    fs.unlinkSync(out);
    assert.equal(rebuilt, read('public/tailwind.css'), 'a class changed: run "npm run build:css" and commit public/tailwind.css');
});

test('while the built Dev Editor calls /api on its own site, Vercel must forward it to the API', () => {
    assert.match(read('dev-editor-demo/build-public.mjs'), /fetch\('\/api\/v1\/dev-editor\/execute'/);
    const rewrite = (JSON.parse(read('vercel.json')).rewrites || []).find(r => r.source === '/api/:path*');
    assert.equal(rewrite?.destination, 'https://grammarflow-brain.onrender.com/api/:path*');
});

test('the Python sandbox has its own policy, is always sandboxed, and the site-wide rule leaves it alone', () => {
    const rules = JSON.parse(read('vercel.json')).headers;
    const frame = rules.find(rule => rule.source === '/dev-editor/runner-frame.html');
    const csp = frame.headers.find(h => h.key === 'Content-Security-Policy').value;
    assert.match(csp, /^sandbox allow-scripts;/, 'even opened directly it gets an opaque origin');
    assert.doesNotMatch(csp, /allow-same-origin|unsafe-inline/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /connect-src https:\/\/grammarflow-python-runtime\.vercel\.app;/, 'it can only reach the runtime');
    assert.ok(!frame.headers.some(h => h.key === 'X-Frame-Options'), 'DENY would stop the Dev Editor framing it');
    // every other rule with a policy must not also match the sandbox page, or both policies would apply
    for (const rule of rules.filter(r => r !== frame && r.headers.some(h => h.key === 'Content-Security-Policy' || h.key === 'X-Frame-Options'))) {
        const matches = url => new RegExp('^' + rule.source + '$').test(url);
        assert.equal(matches('/dev-editor/runner-frame.html'), false, rule.source);
        for (const url of ['/', '/index.html', '/dev-editor/', '/dev-editor/index.html', '/dev-editor/runner.js', '/dev-editor/runner-frameXhtml', '/dev-editor/runner-frame.html/', '/dev-editor/runner-frame.html.x', '/dev-editor/runner-frame.html/child']) assert.equal(matches(url), true, url);
    }
});

test('the runner loads the sandbox page with scripts only, and the build ships it', () => {
    const runner = read('dev-editor-demo/runner.js');
    assert.match(runner, /frame\.sandbox = 'allow-scripts';/);
    assert.match(runner, /runner-frame\.html/);
    assert.doesNotMatch(runner, /srcdoc =/, 'a srcdoc frame would inherit the site policy again');
    assert.match(read('dev-editor-demo/build-public.mjs'), /'runner-frame\.html','runner-frame\.js'/);
    assert.match(read('dev-editor-demo/runner-frame.js'), /event\.source !== parent \|\| event\.origin !==/);
});

