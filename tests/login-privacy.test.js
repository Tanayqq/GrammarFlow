const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const load = require('./load-module');

test('login gives the same answer for an unknown email and a wrong password', async () => {
    const hash = bcrypt.hashSync('right-password', 4);
    const controller = load('src/controllers/auth.controller.js', {
        '../services/auth/verification': {}, '../services/auth/localSession': {},
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
