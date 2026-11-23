const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const load = require('./load-module');

const quiet = { log() {}, warn() {}, error() {} };
// The code under test runs in its own context, so compare by value (strict deepEqual also compares prototypes).
const same = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);

// A tiny in-memory user table that behaves like the parts of Prisma the controller uses.
const harness = (users) => {
    const proofs = new Map();
    const calls = { created: [], updated: [], consumed: [] };
    const prisma = { user: {
        async findUnique({ where }) { return users.find(u => Object.entries(where).every(([k, v]) => u[k] === v)) || null; },
        async findFirst({ where }) { return this.findUnique({ where }); },
        async create({ data }) { calls.created.push(data); users.push(data); return data; },
        async update({ where, data }) { const user = users.find(u => u.id === where.id); Object.assign(user, data); calls.updated.push({ where, data }); return user; }
    } };
    const controller = load('src/controllers/auth.controller.js', {
        '../db': prisma,
        '../services/auth/verification': {
            peekProof: async (email, proof) => proofs.get(proof) === email,
            consumeProof: async (email, proof) => { calls.consumed.push(proof); if (proofs.get(proof) !== email) return false; proofs.delete(proof); return true; }
        },
        '../services/auth/localSession': { issueSession: user => `gf_session_for_${user.id}`, getSecret() {} },
        '../services/auth/loginThrottle': { lockedFor: async () => 0, recordFailure: async () => {}, clear: async () => {} },
        nodemailer: { createTransport: () => ({}) }
    }, { console: quiet });
    const call = async (handler, body) => {
        const res = { statusCode: 200, headers: {}, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
        await handler({ body, headers: {} }, res);
        return res;
    };
    return { users, proofs, calls, controller, call };
};

const PASSWORD = 'a long enough password';

test('an account created through Clerk gets a password after the mailbox is proven, and keeps its id and history', async () => {
    const h = harness([{ id: 'user_clerk_123', email: 'g@example.com', name: 'Google Person', password_hash: null }]);
    h.proofs.set('proof-1', 'g@example.com');
    const res = await h.call(h.controller.register, { email: 'G@Example.com', name: 'Typed Name', password: PASSWORD, verificationToken: 'proof-1' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.user.id, 'user_clerk_123', 'the same account, so its history stays');
    assert.equal(res.body.data.token, 'gf_session_for_user_clerk_123');
    assert.equal(h.calls.created.length, 0, 'no second account was created');
    assert.equal(h.calls.updated.length, 1);
    same(h.calls.updated[0].where, { id: 'user_clerk_123' });
    assert.equal(await bcrypt.compare(PASSWORD, h.users[0].password_hash), true, 'the password is stored hashed');
    assert.equal(h.users[0].name, 'Google Person', 'the existing name is kept');
    // and now the password works for login
    const login = await h.call(h.controller.login, { email: 'g@example.com', password: PASSWORD });
    assert.equal(login.statusCode, 200);
    assert.equal(login.body.data.user.id, 'user_clerk_123');
});

test('an account that already has a password still answers 409, and its proof is not spent', async () => {
    const h = harness([{ id: 'u1', email: 'p@example.com', name: 'P', password_hash: 'existing-hash' }]);
    h.proofs.set('proof-2', 'p@example.com');
    const res = await h.call(h.controller.register, { email: 'p@example.com', name: 'P', password: PASSWORD, verificationToken: 'proof-2' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'EMAIL_EXISTS');
    assert.equal(h.calls.updated.length, 0, 'the password is never overwritten');
    assert.equal(h.calls.consumed.length, 0);
    assert.equal(h.users[0].password_hash, 'existing-hash');
});

test('without a proof the answer is 403 for every email, so nothing can be linked or looked up', async () => {
    const h = harness([{ id: 'user_clerk_123', email: 'g@example.com', name: 'G', password_hash: null }]);
    const known = await h.call(h.controller.register, { email: 'g@example.com', name: 'G', password: PASSWORD, verificationToken: 'forged' });
    const unknown = await h.call(h.controller.register, { email: 'nobody@example.com', name: 'N', password: PASSWORD, verificationToken: 'forged' });
    assert.equal(known.statusCode, 403);
    same(known, unknown);
    h.proofs.set('proof-for-someone-else', 'someone@example.com');
    const wrongMailbox = await h.call(h.controller.register, { email: 'g@example.com', name: 'G', password: PASSWORD, verificationToken: 'proof-for-someone-else' });
    assert.equal(wrongMailbox.statusCode, 403, 'a proof for another mailbox links nothing');
    assert.equal(h.calls.updated.length, 0);
    assert.equal(h.users[0].password_hash, null);
});

test('a new email still creates a new account', async () => {
    const h = harness([]);
    h.proofs.set('proof-3', 'new@example.com');
    const res = await h.call(h.controller.register, { email: 'new@example.com', name: 'New', password: PASSWORD, verificationToken: 'proof-3' });
    assert.equal(res.statusCode, 200);
    assert.equal(h.calls.created.length, 1);
    assert.equal(h.calls.updated.length, 0);
    assert.equal(h.proofs.has('proof-3'), false, 'the proof is spent');
});
