const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const load = require('./load-module');

const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

function controller(create) {
    const saved = [], logged = [];
    const api = load('src/controllers/feedback.controller.js', {
        '../db': { feedback: { create: async ({ data }) => { if (create) await create(); saved.push(data); } } }
    }, { console: { log() {}, warn() {}, error: (...a) => logged.push(a.join(' ')) } });
    const send = async body => {
        let status = 200, json;
        await api.submitFeedback({ body }, { status(n) { status = n; return this; }, json(v) { json = v; return this; } });
        return { status, json };
    };
    return { send, saved, logged };
}

test('good feedback is saved with nothing but the kind, message and optional email', async () => {
    const { send, saved } = controller();
    assert.equal((await send({ kind: 'broken', message: '  The PDF button did nothing  ', email: ' a@b.co ', userId: 'x', extra: 1 })).status, 201);
    assert.equal((await send({ kind: 'idea', message: 'Add dark mode' })).status, 201);
    same(saved, [{ kind: 'broken', message: 'The PDF button did nothing', email: 'a@b.co' }, { kind: 'idea', message: 'Add dark mode', email: null }]);
});

test('bad input is refused and never saved', async () => {
    const { send, saved } = controller();
    const bad = [
        {}, null, { kind: 'spam', message: 'hello there' }, { kind: 'idea' }, { kind: 'idea', message: '  a ' },
        { kind: 'idea', message: 'x'.repeat(2001) }, { kind: 'idea', message: ['hello'] },
        { kind: 'idea', message: 'hello', email: 'not-an-address' }, { kind: 'idea', message: 'hello', email: { a: 1 } },
        { kind: 'idea', message: 'hello', email: 'a@' + 'b'.repeat(260) + '.co' }
    ];
    for (const body of bad) assert.equal((await send(body)).status, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(saved.length, 0);
});

test('a bot that fills the hidden field is answered normally and nothing is stored', async () => {
    const { send, saved } = controller();
    assert.equal((await send({ kind: 'idea', message: 'buy now', website: 'http://spam.example' })).status, 201);
    assert.equal(saved.length, 0);
});

test('when the database fails the visitor is told, and the log holds no private text', async () => {
    const { send, logged } = controller(async () => { const e = new Error('secret message from a@b.co'); e.code = 'P2021'; throw e; });
    const result = await send({ kind: 'broken', message: 'secret message', email: 'a@b.co' });
    assert.equal(result.status, 503);
    assert.match(logged.join(' '), /P2021/);
    assert.doesNotMatch(logged.join(' '), /secret|a@b\.co/);
});

test('the route is limited, and the new table is closed to the Supabase web API', () => {
    assert.match(read('src/routes/ai.routes.js'), /router\.post\('\/feedback', feedbackLimiter, submitFeedback\)/);
    const sql = read('prisma/migrations/20261128000000_add_feedback/migration.sql');
    assert.match(sql, /ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;/);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
});

test('the page has a form instead of an email address', () => {
    const html = read('public/index.html');
    assert.match(html, /<form id="feedbackForm"/);
    assert.doesNotMatch(html, /mailto:|@gmail\.com/i);
});

async function page(reply) {
    const dom = new JSDOM(read('public/index.html').replace(/^[^<]+/, ''), { url: 'https://grammarflow.example/', runScripts: 'outside-only' });
    const w = dom.window, calls = [];
    w.AbortSignal.timeout = () => undefined;
    w.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body), headers: options.headers }); return reply(); };
    w.eval(read('public/feedback.js'));
    const el = id => w.document.getElementById(id);
    const submit = async () => {
        el('feedbackForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
        for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    };
    return { w, el, submit, calls };
}

test('the form sends only its own fields, thanks the visitor and clears the message', async () => {
    const p = await page(() => ({ ok: true, status: 201, json: async () => ({ success: true }) }));
    p.el('feedbackMessage').value = 'The teleprompter was too fast';
    await p.submit();
    same(Object.keys(p.calls[0].body), ['kind', 'message', 'email', 'website']);
    same(Object.keys(p.calls[0].headers), ['Content-Type'], 'no sign-in token or guest id is sent');
    assert.match(p.calls[0].url, /\/api\/v1\/feedback$/);
    assert.equal(p.el('feedbackMessage').value, '');
    assert.match(p.el('feedbackStatus').textContent, /Thank you/);
    assert.equal(p.el('feedbackSend').disabled, false);
});

test('an empty message is not sent, and a failure keeps what was typed', async () => {
    const empty = await page(() => { throw new Error('must not be called'); });
    await empty.submit();
    assert.equal(empty.calls.length, 0);

    for (const [reply, expected] of [
        [() => ({ ok: false, status: 503, json: async () => ({ success: false, error: { message: 'We could not save your feedback just now.' } }) }), /could not save/],
        [() => ({ ok: false, status: 429, json: async () => ({}) }), /wait a few minutes/],
        [() => { throw new TypeError('offline'); }, /Could not reach the server/]
    ]) {
        const p = await page(reply);
        p.el('feedbackMessage').value = 'My message';
        await p.submit();
        assert.equal(p.el('feedbackMessage').value, 'My message');
        assert.match(p.el('feedbackStatus').textContent, expected);
        assert.equal(p.el('feedbackSend').disabled, false);
    }
});

test('text typed while the message is sending is not erased', async () => {
    let finish;
    const p = await page(() => new Promise(resolve => { finish = () => resolve({ ok: true, status: 201, json: async () => ({ success: true }) }); }));
    p.el('feedbackMessage').value = 'First message';
    await p.submit();
    p.el('feedbackMessage').value = 'First message, and one more thing';
    finish();
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    assert.equal(p.el('feedbackMessage').value, 'First message, and one more thing');
});

test('every table the app has is closed to the Supabase web API by a migration', () => {
    const { readdirSync } = require('node:fs');
    const dir = path.join(__dirname, '..', 'prisma', 'migrations');
    const sql = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => read(`prisma/migrations/${e.name}/migration.sql`)).join('\n');
    const models = [...read('prisma/schema.prisma').matchAll(/^model (\w+) \{/gm)].map(m => m[1]);
    assert.ok(models.length >= 4);
    for (const model of models) assert.match(sql, new RegExp(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY;`), `${model}: add row level security in its migration`);
    assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY|CREATE POLICY/i);
});

