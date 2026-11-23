const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const load = require('./load-module');

test('login gives the same answer for an unknown email and a wrong password', async () => {
    const hash = bcrypt.hashSync('right-password', 4);
    const controller = load('src/controllers/auth.controller.js', {
        '../services/auth/verification': {}, '../services/auth/localSession': {}, '../services/auth/loginThrottle': { lockedFor: async () => 0, recordFailure: async () => {}, clear: async () => {} },
        '../db': { user: { findFirst: async ({ where }) => where.email === 'known@example.com' ? { id: 'u1', email: where.email, password_hash: hash } : where.email === 'clerk@example.com' ? { id: 'u2', email: where.email, password_hash: null } : null } }
    }, { console: { log() {}, error() {}, warn() {} } });
    const call = async body => {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, cookie() {} };
        await controller.login({ body, headers: {} }, res);
        return { status: res.statusCode, body: res.body };
    };
    const unknown = await call({ email: 'nobody@example.com', password: 'x' });
    const wrong = await call({ email: 'known@example.com', password: 'wrong-password' });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown, wrong);
    assert.deepEqual(await call({ email: 'clerk@example.com', password: 'x' }), unknown); // Clerk-only accounts too
});

test('a locked account is refused before any password work, and failures and successes are counted', async () => {
    const hash = bcrypt.hashSync('right-password', 4);
    const calls = [];
    let locked = 0;
    let lookups = 0;
    const throttle = {
        lockedFor: async email => { calls.push(['lockedFor', email]); return locked; },
        recordFailure: async email => { calls.push(['fail', email]); },
        clear: async email => { calls.push(['clear', email]); }
    };
    const controller = load('src/controllers/auth.controller.js', {
        '../services/auth/verification': {}, '../services/auth/loginThrottle': throttle,
        '../services/auth/localSession': { issueSession: () => 'gf_session_token', getSecret() {} },
        '../db': { user: { findFirst: async ({ where }) => { lookups++; return where.email === 'known@example.com' ? { id: 'u1', email: where.email, name: 'K', password_hash: hash } : null; } } }
    }, { console: { log() {}, error() {}, warn() {} } });
    const call = async body => {
        const res = { statusCode: 200, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
        await controller.login({ body, headers: {} }, res);
        return res;
    };
    await call({ email: 'known@example.com', password: 'wrong' });
    await call({ email: 'nobody@example.com', password: 'wrong' });
    assert.deepEqual(calls.filter(c => c[0] === 'fail').map(c => c[1]), ['known@example.com', 'nobody@example.com'], 'wrong passwords and unknown emails are both counted');
    const ok = await call({ email: 'KNOWN@example.com', password: 'right-password' });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(calls.at(-1), ['clear', 'known@example.com'], 'a right password clears the count, under the cleaned email');
    locked = 120;
    const before = lookups;
    const refused = await call({ email: 'known@example.com', password: 'right-password' });
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.body.error.code, 'TOO_MANY_ATTEMPTS');
    assert.equal(refused.headers['Retry-After'], '120');
    assert.match(refused.body.error.message, /2 minutes/);
    assert.equal(lookups, before, 'no database lookup and no password check while locked');
});
