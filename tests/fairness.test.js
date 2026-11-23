const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const load = require('./load-module');
const { isDatabaseDown, databaseHint } = require('../src/utils/databaseError');
const clientConcurrency = require('../src/middlewares/clientConcurrency');

const quiet = { log() {}, warn() {}, error() {} };

// ---- a database outage is "try again", not a bug ----
test('database outages are told apart from bugs, and the log hint names the likely cause', () => {
    for (const error of [
        Object.assign(new Error('Can\'t reach database server'), { code: 'P1001' }),
        Object.assign(new Error('x'), { name: 'PrismaClientInitializationError' }),
        new Error('connect ECONNREFUSED 10.0.0.1:5432'),
        new Error('self-signed certificate in certificate chain'),
        new Error('Connection terminated unexpectedly'),
        new Error('password authentication failed for user "postgres"')
    ]) assert.equal(isDatabaseDown(error), true, error.message);
    for (const error of [
        Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { code: 'P2002' }),
        new TypeError('Cannot read properties of undefined'),
        null, undefined
    ]) assert.equal(isDatabaseDown(error), false, String(error && error.message));

    assert.match(databaseHint(new Error('self-signed certificate in certificate chain')), /DATABASE_CA_CERT/);
    assert.match(databaseHint(Object.assign(new Error('x'), { code: 'P1001' })), /Supabase.*pauses.*Restore/);
    assert.match(databaseHint(new Error('connect ECONNREFUSED 1.2.3.4:5432')), /cannot be reached/);
    assert.match(databaseHint(new Error('getaddrinfo ENOTFOUND db.example.com')), /DATABASE_URL/);
    assert.match(databaseHint(new Error('password authentication failed')), /user and password/);
    assert.equal(databaseHint(new Error('something else')), '');
});

const fakeRes = () => Object.assign(new EventEmitter(), {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});
const authController = (prisma) => load('src/controllers/auth.controller.js', {
    '../db': prisma,
    '../services/auth/verification': {},
    nodemailer: { createTransport: () => ({}) }
}, { console: quiet });
const call = async (handler, body) => { const res = fakeRes(); await handler({ body, headers: {} }, res); return res; };

test('login, register and sign-up codes answer 503 with a short wait when the database is down', async () => {
    const down = Object.assign(new Error('Can\'t reach database server'), { code: 'P1001' });
    const prisma = { user: { findFirst: async () => { throw down; }, findUnique: async () => { throw down; } } };
    process.env.SESSION_SECRET = 'a-synthetic-session-secret-of-at-least-32-bytes'; // register checks it before it reads the database
    const controller = authController(prisma);
    for (const [name, body] of [
        ['login', { email: 'a@example.com', password: 'correct horse battery' }],
        ['sendVerificationCode', { email: 'a@example.com' }],
        ['register', { email: 'a@example.com', name: 'A', password: 'correct horse battery', verificationToken: 'x' }]
    ]) {
        const res = await call(controller[name], body);
        assert.equal(res.statusCode, 503, name);
        assert.equal(res.body.error.code, 'DATABASE_OFFLINE', name);
        assert.equal(res.headers['Retry-After'], '30', name);
        assert.doesNotMatch(JSON.stringify(res.body), /P1001|reach database|Supabase/, `${name} must not leak the cause`);
    }
});

test('an ordinary bug during login is still a 500, not mistaken for an outage', async () => {
    const prisma = { user: { findFirst: async () => { throw new TypeError('unexpected shape'); } } };
    const res = await call(authController(prisma).login, { email: 'a@example.com', password: 'correct horse battery' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'SERVER_ERROR');
});

// ---- one client cannot take every AI slot ----
test('a client may run only a few AI requests at once; the next waits, others are unaffected', () => {
    const limit = clientConcurrency.MAX_PER_CLIENT;
    const open = [];
    const enter = (req) => { const res = fakeRes(); let passed = false; clientConcurrency(req, res, () => { passed = true; }); return { res, passed }; };
    for (let i = 0; i < limit; i++) { const r = enter({ rateLimitKey: 'ip-1' }); assert.equal(r.passed, true); open.push(r.res); }
    const blocked = enter({ rateLimitKey: 'ip-1' });
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.body.error.code, 'PLEASE_WAIT');
    assert.equal(blocked.res.headers['Retry-After'], '2');
    assert.equal(enter({ rateLimitKey: 'ip-2' }).passed, true, 'another client is not affected');
    open[0].emit('close');
    assert.equal(enter({ rateLimitKey: 'ip-1' }).passed, true, 'a finished request frees a slot');
});

test('a slot is freed once even if close fires twice, and a missing key falls back to the user then the IP', () => {
    const limit = clientConcurrency.MAX_PER_CLIENT;
    const held = [];
    for (let i = 0; i < limit; i++) { const res = fakeRes(); clientConcurrency({ rateLimitKey: 'k' }, res, () => {}); held.push(res); }
    held[0].emit('close'); held[0].emit('close'); // the second must not free another slot
    let first = false, second = false;
    clientConcurrency({ rateLimitKey: 'k' }, fakeRes(), () => { first = true; });
    clientConcurrency({ rateLimitKey: 'k' }, fakeRes(), () => { second = true; });
    assert.equal(first, true);
    assert.equal(second, false, 'only one slot was freed');

    const byUser = [];
    for (let i = 0; i < limit; i++) { const res = fakeRes(); clientConcurrency({ user: { id: 'u1' }, ip: '1.1.1.1' }, res, () => {}); byUser.push(res); }
    let userPassed = false;
    clientConcurrency({ user: { id: 'u1' }, ip: '2.2.2.2' }, fakeRes(), () => { userPassed = true; });
    assert.equal(userPassed, false, 'the signed-in user is the client, whatever the IP');
    let ipPassed = false;
    clientConcurrency({ ip: '9.9.9.9' }, fakeRes(), () => { ipPassed = true; });
    assert.equal(ipPassed, true, 'with no user, the IP is the client');
});

test('every AI route goes through the per-client limit', () => {
    const routes = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/routes/ai.routes.js'), 'utf8');
    for (const path of ['rewrite', 'grammar-fix', 'suggestions', 'autocomplete', 'analyze-realtime', 'analyze-smart', 'process-document', 'humanize']) {
        const line = routes.split('\n').find(l => l.includes(`router.post('/${path}'`));
        assert.ok(line && /clientConcurrency/.test(line), `${path} is missing clientConcurrency`);
    }
});

// ---- production must not run on Clerk development keys ----
test('production on Clerk development keys logs a loud warning; live keys and development stay quiet', () => {
    const key = prefix => `${prefix}_${Buffer.from('clerk.example.lcl.dev$').toString('base64')}`;
    const build = env => {
        const warnings = [];
        const Provider = load('src/services/auth/ClerkAuthProvider.js', {}, {
            console: { log() {}, error() {}, warn: message => warnings.push(message) },
            process: { ...process, env: { ...env } }
        });
        new Provider();
        return warnings.filter(w => /DEVELOPMENT keys/.test(w));
    };
    assert.equal(build({ NODE_ENV: 'production', CLERK_PUBLISHABLE_KEY: key('pk_test') }).length, 1);
    assert.equal(build({ RENDER: 'true', CLERK_PUBLISHABLE_KEY: key('pk_live') }).length, 0, 'live keys are fine');
    assert.equal(build({ NODE_ENV: 'production', CLERK_PUBLISHABLE_KEY: key('pk_live'), CLERK_SECRET_KEY: 'sk_test_abc' }).length, 1, 'a test secret key counts too');
    assert.equal(build({ NODE_ENV: 'development', CLERK_PUBLISHABLE_KEY: key('pk_test') }).length, 0, 'development may use development keys');
});
