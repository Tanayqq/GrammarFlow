const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const load = require('./load-module');

const redis = new Redis(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:16379', {
    lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null
});
const keys = [];
const email = () => `${randomUUID()}@example.com`;
const hash = value => createHash('sha256').update(value).digest('hex');
const verification = load('src/services/auth/verification.js', { '../../queue': { redisConnection: redis } });
process.env.SESSION_SECRET = 'test-only-session-secret-with-at-least-32-bytes';
const sessions = require('../src/services/auth/localSession');
before(() => redis.connect());
after(async () => {
    if (keys.length) await redis.del(...keys);
    await redis.quit();
});

test('sessions reject unsigned mocks, forged, expired, wrong-audience and wrong-algorithm tokens', async () => {
    const service = load('src/services/auth/AuthService.js', {
        './ClerkAuthProvider': class { async verifyToken() { throw new Error('invalid'); } }
    });
    const user = { id: 'existing-user-id', email: email(), name: 'Existing User' };
    const token = sessions.issueSession(user);
    assert.deepEqual(await service.verifySessionToken(token), user);
    assert.equal(await service.verifySessionToken('mock_token_victim@example.com_Name'), null);
    assert.equal(await service.verifySessionToken(token + 'x'), null);
    for (const extra of [{ expiresIn: -1 }, { audience: 'other-app' }, { algorithm: 'HS384' }]) {
        const forged = jwt.sign({ email: user.email }, process.env.SESSION_SECRET, {
            subject: user.id, algorithm: 'HS256', issuer: 'grammarflow', audience: 'grammarflow-web', ...extra
        });
        assert.equal(await service.verifySessionToken(sessions.prefix + forged), null);
    }
    const secret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try { assert.throws(() => sessions.issueSession(user), /SESSION_SECRET/); }
    finally { process.env.SESSION_SECRET = secret; }
});

test('OTP and email-bound proof are single-use under concurrency', async () => {
    const address = email();
    const code = await verification.createChallenge(address);
    assert.match(code, /^\d{6}$/);
    await assert.rejects(verification.createChallenge(address), /already sent/);
    const proofs = await Promise.all(Array.from({ length: 8 }, () => verification.verifyChallenge(address, code)));
    assert.equal(proofs.filter(Boolean).length, 1);
    const proof = proofs.find(Boolean);
    assert.equal(await verification.consumeProof(email(), proof), false);
    const results = await Promise.all(Array.from({ length: 8 }, () => verification.consumeProof(address, proof)));
    assert.equal(results.filter(Boolean).length, 1);
});

test('five bad guesses invalidate the OTP, expiry and Redis outage fail closed', async () => {
    const address = email();
    const code = await verification.createChallenge(address);
    const wrong = code === '100000' ? '100001' : '100000';
    for (let i = 0; i < 5; i++) assert.equal(await verification.verifyChallenge(address, wrong), null);
    assert.equal(await verification.verifyChallenge(address, code), null);
    const expired = email();
    const expiredCode = await verification.createChallenge(expired);
    await redis.pexpire(`gf:otp:${hash(expired)}`, 0);
    assert.equal(await verification.verifyChallenge(expired, expiredCode), null);
    const address2 = email();
    const proof = await verification.verifyChallenge(address2, await verification.createChallenge(address2));
    await redis.pexpire(`gf:verified:${hash(proof)}`, 0);
    assert.equal(await verification.consumeProof(address2, proof), false);
    const offline = load('src/services/auth/verification.js', { '../../queue': { redisConnection: { status: 'end' } } });
    await assert.rejects(offline.createChallenge(email()), /unavailable/);
    await assert.rejects(offline.consumeProof(email(), 'a'.repeat(64)), /unavailable/);
});

test('Redis limiter counts every same-millisecond request and ignores guest-header rotation', async () => {
    let now = Date.now();
    const config = load('src/middlewares/rateLimiter.js', {
        '../queue': { redisConnection: redis },
        'express-rate-limit': { ...require('express-rate-limit'), rateLimit: options => options }
    }, { Date: class extends Date { static now() { return now; } } });
    const key = `test:limiter:${randomUUID()}`;
    keys.push(key);
    const counts = await Promise.all(Array.from({ length: 30 }, () => config.aiLimiter.store.increment(key)));
    assert.deepEqual(counts.map(c => c.totalHits).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.equal(counts[0].resetTime.getTime(), now + 60000);
    now += 60001;
    assert.equal((await config.aiLimiter.store.increment(key)).totalHits, 1);
    assert.equal(config.aiLimiter.keyGenerator({ ip: '192.0.2.1', headers: { 'x-guest-session-id': 'a' } }),
        config.aiLimiter.keyGenerator({ ip: '192.0.2.1', headers: { 'x-guest-session-id': 'b' } }));
    assert.notEqual(config.aiLimiter.keyGenerator({ ip: '192.0.2.1', user: { id: 'one' } }),
        config.aiLimiter.keyGenerator({ ip: '192.0.2.1', user: { id: 'two' } }));
    const fallback = load('src/middlewares/rateLimiter.js', {
        '../queue': { redisConnection: { status: 'end' } },
        'express-rate-limit': { rateLimit: options => options, ipKeyGenerator: ip => ip }
    });
    assert.equal((await fallback.aiLimiter.store.increment('a')).totalHits, 1);
    assert.equal((await fallback.aiLimiter.store.increment('a')).totalHits, 2);
});

test('database TLS verifies certificates even when the URL requests insecure SSL', () => {
    const previous = process.env.DATABASE_URL;
    const previousCa = process.env.DATABASE_CA_CERT;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db?sslmode=no-verify&ssl=0&uselibpqcompat=true';
    process.env.DATABASE_CA_CERT = 'line1\\nline2';
    let options;
    try {
        load('src/db.js', {
            pg: { Pool: class { constructor(value) { options = value; } } },
            '@prisma/adapter-pg': { PrismaPg: class {} },
            '@prisma/client': { PrismaClient: class { async $connect() {} } }
        });
        const parsed = new (require('pg').Client)(options).connectionParameters;
        assert.equal(parsed.ssl.rejectUnauthorized, true);
        assert.equal(parsed.ssl.ca, 'line1\nline2');
    } finally {
        if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
        if (previousCa === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = previousCa;
    }
});

test('HTTP registration requires OTP proof and login issues a verified server session', async () => {
    const users = new Map();
    let sentCode;
    let failDelivery = false;
    let migrated = false;
    const prisma = { user: {
        async findUnique({ where }) { return [...users.values()].find(u => Object.entries(where).every(([k, v]) => u[k] === v)) || null; },
        async findFirst({ where }) { return this.findUnique({ where }); },
        async create({ data }) { users.set(data.id, data); return data; },
        async upsert({ where }) { return users.get(where.id); }
    }, async $transaction() { migrated = true; } };
    const controller = load('src/controllers/auth.controller.js', {
        '../db': prisma,
        '../services/auth/verification': verification,
        nodemailer: { createTransport: () => ({ async sendMail(message) {
            if (failDelivery) throw new Error('test SMTP failure');
            sentCode = message.text.match(/\d{6}/)[0];
        } }) }
    });
    const service = load('src/services/auth/AuthService.js', {
        './ClerkAuthProvider': class { async verifyToken() { throw new Error('invalid'); } }
    });
    const middleware = load('src/middlewares/auth.js', { '../services/auth/AuthService': service });
    const rateLimiters = load('src/middlewares/rateLimiter.js', { '../queue': { redisConnection: redis } });
    keys.push('gf:limiter:auth:127.0.0.1');
    await redis.del(keys[keys.length - 1]);
    const router = load('src/routes/auth.routes.js', {
        '../controllers/auth.controller': controller,
        '../middlewares/rateLimiter': rateLimiters,
        '../middlewares/auth': middleware
    });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/auth', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (endpoint, data, token) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-guest-session-id': randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(data)
        });
        return { status: response.status, body: await response.json() };
    };
    const address = email();
    const userData = { email: address, name: 'Test User', password: 'test-password-123' };
    const previousSmtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].map(key => [key, process.env[key]]);
    for (const [key] of previousSmtp) process.env[key] = 'test-only';
    try {
        assert.equal((await request('register', userData)).status, 403);
        assert.equal(users.size, 0);
        failDelivery = true;
        assert.equal((await request('send-verification-code', { email: address })).status, 503);
        failDelivery = false;
        const sent = await request('send-verification-code', { email: address });
        assert.equal(sent.status, 200);
        assert.equal(JSON.stringify(sent.body).includes(sentCode), false);
        const verified = await request('verify-code', { email: address, code: sentCode });
        assert.equal(verified.status, 200);
        const verificationToken = verified.body.data.verificationToken;
        assert.equal((await request('register', { ...userData, email: email(), verificationToken })).status, 403);
        const registered = await request('register', { ...userData, verificationToken });
        assert.equal(registered.status, 200);
        assert.equal(sessions.verifySession(registered.body.data.token).email, address);
        assert.notEqual([...users.values()][0].password_hash, userData.password);
        assert.equal((await request('register', { ...userData, verificationToken })).status, 409);
        assert.equal((await request('login', { email: address, password: 'wrong' })).status, 401);
        const loggedIn = await request('login', userData);
        assert.equal(loggedIn.status, 200);
        assert.equal(sessions.verifySession(loggedIn.body.data.token).id, registered.body.data.user.id);
        assert.equal((await request('sync', {}, `mock_token_${address}_Test`)).status, 401);
        assert.equal((await request('sync', {}, loggedIn.body.data.token + 'x')).status, 401);
        // A registered account linked to an old guest header must never migrate to another account.
        users.set('victim', { id: 'victim', email: email(), password_hash: 'hash', guest_session_id: 'old-guest' });
        assert.equal((await request('sync', { guestSessionId: 'old-guest' }, loggedIn.body.data.token)).status, 200);
        assert.equal(migrated, false);
        // Historical local account IDs remain usable after replacing unsigned tokens.
        const legacy = { id: 'mock_user_legacy', email: email(), name: 'Legacy', password_hash: [...users.values()][0].password_hash };
        users.set(legacy.id, legacy);
        const legacyLogin = await request('login', { email: legacy.email, password: userData.password });
        assert.equal(sessions.verifySession(legacyLogin.body.data.token).id, legacy.id);
        let limited = false;
        for (let i = 0; i < 20; i++) {
            if ((await request('login', { email: address, password: 'wrong' })).status === 429) { limited = true; break; }
        }
        assert.equal(limited, true, 'rotating guest headers must not bypass the auth quota');
    } finally {
        for (const [key, value] of previousSmtp) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await new Promise(resolve => server.close(resolve));
    }
});

test('browser requests retain server sessions when Clerk is signed out', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../public/app-v16.js'), 'utf8');
    const storage = new Map([['gf_token', 'gf_session_test']]);
    let authorization;
    const context = {
        window: { location: { hostname: 'localhost' }, Clerk: { user: null } },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        crypto: { randomUUID }, console,
        fetch: async (url, options) => {
            authorization = options.headers.Authorization;
            return { ok: true, json: async () => ({ success: true }) };
        }
    };
    vm.runInNewContext(source.slice(0, source.indexOf('class MomentumEngine')) + '\nglobalThis.request = GrammarFlowAPI.request.bind(GrammarFlowAPI);', context);
    await context.request('/auth/sync', {});
    assert.equal(authorization, 'Bearer gf_session_test');
    assert.equal(storage.get('gf_token'), 'gf_session_test');
});

test('a leaked guest header cannot read or delete registered-account history', async () => {
    let owner = { guest_session_id: 'leaked-header', email: 'owner@example.com', password_hash: 'hash' };
    let deleted = false;
    const controller = load('src/controllers/ai.controller.js', {
        '../services/ai.service': {}, '../queue': {}, '../historyQueue': {}, '../historyWorker': {},
        '../db': { aiOperation: {
            async findUnique({ include }) {
                const selected = Object.fromEntries(Object.keys(include.user.select).map(key => [key, owner[key]]));
                return { id: 'operation', user_id: 'owner', user: selected };
            },
            async delete() { deleted = true; }
        } }
    });
    const invoke = async (fn, userId = null) => {
        const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await fn({ headers: { 'x-guest-session-id': 'leaked-header' }, params: { id: 'operation' }, userId }, response);
        return response.statusCode;
    };
    assert.equal(await invoke(controller.getHistoryDetail), 403);
    assert.equal(await invoke(controller.deleteHistory), 403);
    assert.equal(deleted, false);
    assert.equal(await invoke(controller.getHistoryDetail, 'owner'), 200);
    assert.equal(await invoke(controller.getHistoryDetail, 'other-user'), 403);
    owner = { guest_session_id: 'leaked-header', email: null, password_hash: null };
    assert.equal(await invoke(controller.getHistoryDetail), 200);
    assert.equal(await invoke(controller.deleteHistory), 200);
    assert.equal(deleted, true);
});
