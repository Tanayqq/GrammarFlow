const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const load = require('./load-module');
const { readGuestId, cleanGuestId } = require('../src/utils/guestId');

const quiet = { log() {}, warn() {}, error() {} };
// The code under test runs in its own context, so compare by value (strict deepEqual also compares prototypes).
const same = (a, b, message) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);
const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');

// ---------- guest ids ----------
test('a guest id must be a plain token of 16 to 64 characters; anything else counts as "no guest"', () => {
    for (const ok of [randomUUID(), 'unguessable-guest', 'a'.repeat(16), 'A1_-'.repeat(16)]) assert.equal(cleanGuestId(ok), ok);
    for (const bad of ['', 'short', 'a'.repeat(15), 'a'.repeat(65), 'has a space 1234567890', 'unicode-ünï-1234567890', "quote'; DROP TABLE users;--", ['a'.repeat(20)], undefined, null, 42, {}]) {
        assert.equal(cleanGuestId(bad), null, JSON.stringify(bad));
    }
    assert.equal(readGuestId({ headers: { 'x-guest-session-id': 'x'.repeat(5000) } }), null, 'a huge header is not stored');
    assert.equal(readGuestId({ headers: {} }), null);
});

const marks = [];
const controllerWith = prisma => load('src/controllers/ai.controller.js', {
    '../services/ai.service': {}, '../queue': {}, '../historyQueue': {}, '../historyWorker': { markHistoryCleared: async owner => { marks.push(owner); } }, '../db': prisma
}, { console: quiet });
const reply = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const run = async (handler, req) => { const res = reply(); await handler({ headers: {}, params: {}, body: {}, query: {}, ...req }, res); return res; };

test('history endpoints ignore a malformed guest header instead of using it', async () => {
    const lookups = [];
    const controller = controllerWith({ user: { findUnique: async args => { lookups.push(args); return null; } } });
    const res = await run(controller.getHistory, { headers: { 'x-guest-session-id': "x'; DROP TABLE users;--" } });
    assert.equal(res.statusCode, 400);
    assert.equal(lookups.length, 0, 'no database lookup with a malformed id');
});

// ---------- clear all history ----------
const GUEST = 'guest-session-0123456789';
const clearing = (users) => {
    const calls = { deleted: [], lookups: [] };
    const prisma = {
        user: { findUnique: async ({ where }) => { calls.lookups.push(where); return users.find(u => Object.entries(where).every(([k, v]) => u[k] === v)) || null; } },
        aiOperation: { deleteMany: async ({ where }) => { calls.deleted.push(where); return { count: 7 }; } }
    };
    return { calls, handler: controllerWith(prisma).deleteAllHistory };
};

test('Clear all deletes the signed-in user\'s own history, whatever the request body says', async () => {
    const { calls, handler } = clearing([]);
    const res = await run(handler, { userId: 'me', body: { user_id: 'victim' }, params: { id: 'victim' }, query: { user_id: 'victim' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.deleted, 7);
    same(calls.deleted, [{ user_id: 'me' }]);
    same(marks.slice(-1), ['me'], 'the clear is recorded, so saves queued earlier are dropped');
    assert.equal(calls.lookups.length, 0);
});

test('Clear all for a guest deletes that guest\'s history only', async () => {
    const { calls, handler } = clearing([{ id: 'g1', guest_session_id: GUEST, email: null, password_hash: null }, { id: 'g2', guest_session_id: 'another-guest-9876543210', email: null, password_hash: null }]);
    const res = await run(handler, { headers: { 'x-guest-session-id': GUEST } });
    assert.equal(res.body.data.deleted, 7);
    same(calls.deleted, [{ user_id: 'g1' }]);
    same(marks.slice(-1), [GUEST], 'a guest is recorded under the session id the writer sees');
});

test('a guest header can never clear a registered account\'s history, and unknown guests delete nothing', async () => {
    const { calls, handler } = clearing([{ id: 'owner', guest_session_id: GUEST, email: 'o@example.com', password_hash: 'hash' }]);
    const registered = await run(handler, { headers: { 'x-guest-session-id': GUEST } });
    assert.equal(registered.statusCode, 200);
    assert.equal(registered.body.data.deleted, 0);
    const marksBefore = marks.length;
    const unknown = await run(handler, { headers: { 'x-guest-session-id': 'never-seen-before-12345' } });
    assert.equal(unknown.body.data.deleted, 0);
    assert.equal(calls.deleted.length, 0, 'nothing was deleted');
    same(marks.slice(marksBefore), ['never-seen-before-12345'], 'a guest with no row yet still has the clear recorded, for a first save that is still queued');
    const afterRegistered = marks.length;
    await run(handler, { headers: { 'x-guest-session-id': GUEST } });
    assert.equal(marks.length, afterRegistered, 'a registered account\'s id is never recorded through a guest header');
});

test('Clear all needs an identity, and reports a database outage as 503', async () => {
    const { handler } = clearing([]);
    assert.equal((await run(handler, {})).statusCode, 400);
    assert.equal((await run(handler, { headers: { 'x-guest-session-id': 'bad id' } })).statusCode, 400);
    const down = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    const res = await run(controllerWith({ aiOperation: { deleteMany: async () => { throw down; } } }).deleteAllHistory, { userId: 'me' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'DATABASE_OFFLINE');
});

test('DELETE /history is registered ahead of DELETE /history/:id, and the page has a Clear all button wired to it', () => {
    const routes = read('src/routes/ai.routes.js');
    assert.ok(routes.indexOf("router.delete('/history',") > 0 && routes.indexOf("router.delete('/history',") < routes.indexOf("router.delete('/history/:id'"));
    const html = read('public/index.html');
    assert.match(html, /id="clearHistoryBtn"/);
    assert.match(html, /copies on our servers expire on their own after 30 days for guests and one year when signed in/, 'the privacy note says how long history is kept');
    assert.match(html, /A copy kept for offline use stays in this browser until you clear History/, 'and that offline copies stay until cleared');
    assert.match(read('public/app-v16.js'), /clearHistoryBtn[\s\S]{0,900}GrammarFlowAPI\.request\("\/history", undefined, "DELETE"\)/);
    const app = read('public/app-v16.js');
    assert.match(app, /Couldn't clear history[\s\S]{0,200}loadHistory\(\)/, 'a failed clear reloads the screen');
    assert.equal(app.split('if (epoch !== historyEpoch) return').length - 1, 4, 'both history readers drop stale answers, before and after a failure');
});

// ---------- retention ----------
const retention = load('src/historyRetention.js', {}, { console: quiet, setInterval, clearInterval });
const DAY = 86400000;

const retentionDb = ({ guestOps = [], userOps = [], emptyGuests = [] }) => {
    const calls = { opWhere: [], deletedOps: [], deleteWheres: [], settings: [], users: [] };
    const queues = { guest: [...guestOps], user: [...userOps] };
    return {
        calls,
        prisma: {
            aiOperation: {
                async findMany({ where, take }) {
                    calls.opWhere.push(where);
                    const which = where.user.is.email === null ? 'guest' : 'user';
                    return queues[which].slice(0, take).map(id => ({ id }));
                },
                async deleteMany({ where }) {
                    calls.deleteWheres.push(where);
                    calls.deletedOps.push(where.id.in);
                    for (const q of Object.values(queues)) for (const id of where.id.in) { const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); }
                    return { count: where.id.in.length };
                }
            },
            user: {
                async findMany({ where, take }) { calls.users.push({ where }); return emptyGuests.splice(0, take).map(id => ({ id })); },
                async deleteMany({ where }) { calls.users.push({ deleted: where.id.in }); return { count: where.id.in.length }; }
            },
            userSettings: { async deleteMany({ where }) { calls.settings.push(where.user_id.in); calls.settingsWhere = where; return { count: 0 }; } },
            $transaction: async operations => Promise.all(operations)
        }
    };
};

test('old history is removed in batches: guests after 30 days, signed-in users after a year', async () => {
    const now = Date.UTC(2026, 10, 23);
    const { calls, prisma } = retentionDb({ guestOps: ['g1', 'g2', 'g3', 'g4', 'g5'], userOps: ['u1'], emptyGuests: ['x1', 'x2', 'x3'] });
    const done = await retention.purgeExpiredHistory(prisma, { now, guestDays: 30, userDays: 365, batch: 2 });
    same(done, { guestOps: 5, userOps: 1, guests: 3 });
    same(calls.deletedOps.slice(0, 3), [['g1', 'g2'], ['g3', 'g4'], ['g5']], 'batches of two');
    const guestWhere = calls.opWhere.find(w => w.user.is.email === null);
    assert.equal(guestWhere.created_at.lt.getTime(), now - 30 * DAY);
    same(guestWhere.user.is, { email: null, password_hash: null }, 'guests only');
    const userWhere = calls.opWhere.find(w => w.user.is.OR);
    assert.equal(userWhere.created_at.lt.getTime(), now - 365 * DAY);
    same(userWhere.user.is.OR, [{ email: { not: null } }, { password_hash: { not: null } }], 'registered accounts only');
    const emptyWhere = calls.users.find(c => c.where).where;
    same([emptyWhere.email, emptyWhere.password_hash, emptyWhere.operations], [null, null, { none: {} }], 'only guests with nothing left');
    same(calls.settings, [['x1', 'x2'], ['x3']], 'settings go before the accounts they belong to');
    // The delete repeats the select's conditions, so an entry moved to a signed-in account in between survives.
    for (const where of calls.deleteWheres) {
        assert.ok(where.created_at && where.created_at.lt, 'the age condition is checked again at delete time');
        assert.ok(where.user && where.user.is, 'and the owner condition too');
    }
    const guestDeletes = calls.deleteWheres.filter(w => w.user.is.email === null);
    assert.equal(guestDeletes.length, 3);
    assert.equal(guestDeletes[0].created_at.lt.getTime(), now - 30 * DAY);
    const accountDelete = calls.users.find(c => c.deleted);
    assert.ok(accountDelete, 'empty guest accounts were deleted');
    assert.equal(calls.settingsWhere.user.is.operations.none !== undefined && calls.settingsWhere.user.is.email === null, true, 'settings are only removed for guests that are still empty');
});

test('one run is bounded and the settings are read safely', async () => {
    const many = Array.from({ length: 50 }, (_, i) => 'id' + i);
    const { calls, prisma } = retentionDb({ guestOps: many });
    const done = await retention.purgeExpiredHistory(prisma, { now: Date.now(), batch: 5, maxBatches: 3 });
    assert.equal(done.guestOps, 15, 'at most maxBatches batches per run');
    assert.equal(calls.deletedOps.length >= 3, true);
    assert.equal(retention.days('7', 30), 7);
    for (const bad of ['0', '-5', 'abc', '99999', '', undefined]) assert.equal(retention.days(bad, 30), 30, String(bad));
});

test('the cleanup starts on a timer that never keeps the process alive, and can be turned off', () => {
    const prisma = retentionDb({}).prisma;
    const timer = retention.start({ prisma, log: quiet });
    assert.ok(timer, 'a timer was created');
    assert.equal(timer.hasRef(), false, 'unref\'d: it cannot keep a process running');
    clearInterval(timer);
    const off = load('src/historyRetention.js', {}, { console: quiet, setInterval, clearInterval, process: { ...process, env: { ...process.env, HISTORY_RETENTION_DISABLED: 'true' } } });
    assert.equal(off.start({ prisma, log: quiet }), null);
    assert.match(read('server.js'), /require\('\.\/src\/historyRetention'\)\.start\(\)/);
});

// ---------- history writes ----------
const worker = prisma => load('src/historyWorker.js', { bullmq: { Worker: class {} }, './queue': { redisConnection: {} }, './db': prisma }, { console: quiet });
const record = { guest_session_id: GUEST, input_text: 'in', output_text: 'out', operation_type: 'rewrite', language: 'English' };

test('a failed history save is reported to the caller, so the queue can retry it', async () => {
    const prisma = { user: { upsert: async () => { throw new Error('database is down'); } }, aiOperation: { create: async () => ({}) } };
    await assert.rejects(worker(prisma).logHistoryRecord(record), /database is down/);
    assert.equal(await worker({}).logHistoryRecord({ input_text: 'x' }), undefined, 'nothing to attach the record to: skipped, no error');
});

test('two first requests from a new guest do not lose the second history entry', async () => {
    let attempts = 0;
    const created = [];
    const clash = Object.assign(new Error('Unique constraint failed on the fields: (`guest_session_id`)'), { code: 'P2002' });
    const prisma = {
        user: { upsert: async () => { if (++attempts === 1) throw clash; return { id: 'g1' }; } },
        aiOperation: { create: async ({ data }) => { created.push(data); } }
    };
    await worker(prisma).logHistoryRecord(record);
    assert.equal(attempts, 2, 'the same lookup ran again and found the row');
    assert.equal(created.length, 1);
    assert.equal(created[0].user_id, 'g1');
    let tries = 0;
    const stuck = { user: { upsert: async () => { tries++; throw clash; } }, aiOperation: { create: async () => {} } };
    await assert.rejects(worker(stuck).logHistoryRecord(record), /Unique constraint/);
    assert.equal(tries, 2, 'one retry only, never a loop');
});

// ---------- Clerk profile cache ----------
const clerk = () => {
    const Provider = load('src/services/auth/ClerkAuthProvider.js', {}, { console: quiet, process: { ...process, env: {} } });
    return new Provider();
};

test('a Clerk profile is looked up once, shared by simultaneous callers, and remembered', async () => {
    const provider = clerk();
    let lookups = 0;
    provider.getUserDetails = async id => { lookups++; await new Promise(r => setTimeout(r, 10)); return { id, email: id + '@example.com', name: 'N' }; };
    const [a, b, c] = await Promise.all([provider.cachedUserDetails('u1'), provider.cachedUserDetails('u1'), provider.cachedUserDetails('u1')]);
    assert.equal(lookups, 1, 'callers that arrive during a lookup share it');
    same(a, b); same(b, c);
    await provider.cachedUserDetails('u1');
    assert.equal(lookups, 1, 'remembered');
    await provider.cachedUserDetails('u2');
    assert.equal(lookups, 2, 'another user is looked up separately');
    provider.detailsCache.get('u1').expires = 0; // ten minutes have passed
    await provider.cachedUserDetails('u1');
    assert.equal(lookups, 3, 'refreshed after the time is up');
});

test('a failed Clerk lookup is remembered briefly, so an outage is not hammered, then retried', async () => {
    const provider = clerk();
    let lookups = 0;
    provider.getUserDetails = async () => { lookups++; throw new Error('Clerk Backend API returned status 429'); };
    await assert.rejects(provider.cachedUserDetails('u1'), /429/);
    await assert.rejects(provider.cachedUserDetails('u1'), /429/);
    assert.equal(lookups, 1, 'the second call did not ask Clerk again');
    provider.detailsCache.get('u1').expires = 0; // thirty seconds have passed
    await assert.rejects(provider.cachedUserDetails('u1'), /429/);
    assert.equal(lookups, 2);
    provider.getUserDetails = async id => ({ id, email: 'e@example.com' });
    assert.equal((await provider.cachedUserDetails('u3')).email, 'e@example.com', 'one failure does not affect other users');
});

test('the Clerk cache stays small, and token verification uses it', async () => {
    const provider = clerk();
    provider.getUserDetails = async id => ({ id });
    for (let i = 0; i < 520; i++) await provider.cachedUserDetails('user' + i);
    assert.ok(provider.detailsCache.size <= 500, `holds ${provider.detailsCache.size} entries`);
    const source = read('src/services/auth/ClerkAuthProvider.js');
    assert.match(source, /this\.cachedUserDetails\(decoded\.sub\)/);
    assert.doesNotMatch(source, /await this\.getUserDetails\(decoded\.sub\)/, 'no uncached lookup on the request path');
});

test('a history save queued before Clear all is dropped, one queued after it is kept', async () => {
    const saved = [];
    const store = new Map();
    const redisConnection = {
        status: 'ready',
        async set(key, value) { store.set(key, value); return 'OK'; },
        async get(key) { return store.get(key) || null; }
    };
    const prisma = { user: { upsert: async () => ({ id: 'g1' }) }, aiOperation: { create: async ({ data }) => { saved.push(data); } } };
    const w = load('src/historyWorker.js', { bullmq: { Worker: class {} }, './queue': { redisConnection }, './db': prisma }, { console: quiet });
    const owner = GUEST;
    const queuedBefore = Date.now() - 50;
    await w.markHistoryCleared(owner);
    const clearedAt = Number(store.get(`gf:histclear:${owner}`));
    assert.ok(clearedAt >= queuedBefore);
    await w.logHistoryRecord({ ...record, guest_session_id: owner, queued_at: clearedAt - 1 });
    assert.equal(saved.length, 0, 'queued before the clear: dropped');
    await w.logHistoryRecord({ ...record, guest_session_id: owner, queued_at: clearedAt + 1 });
    assert.equal(saved.length, 1, 'queued after the clear: kept');
    await w.logHistoryRecord({ ...record, guest_session_id: 'a-different-guest-0123456789', queued_at: clearedAt - 1 });
    assert.equal(saved.length, 2, 'another owner is unaffected');
    await w.logHistoryRecord({ ...record, guest_session_id: owner });
    assert.equal(saved.length, 3, 'a save without a timestamp is never dropped');
    // the signed-in user is keyed by user id, not by a guest header they happen to carry
    await w.markHistoryCleared('user-1');
    const userClearedAt = Number(store.get('gf:histclear:user-1'));
    await w.logHistoryRecord({ ...record, guest_session_id: null, user_id: 'user-1', queued_at: userClearedAt - 1 });
    assert.equal(saved.length, 3);
    // with Redis down the writer still saves (it fails open) and the clear does not throw
    const down = load('src/historyWorker.js', { bullmq: { Worker: class {} }, './queue': { redisConnection: { status: 'end' } }, './db': prisma }, { console: quiet });
    await down.markHistoryCleared(owner);
    await down.logHistoryRecord({ ...record, queued_at: 1 });
    assert.equal(saved.length, 4);
});

test('both history payloads carry the moment they were queued', () => {
    const source = read('src/controllers/ai.controller.js');
    assert.equal(source.split('queued_at:          Date.now(),').length - 1, 2);
    const body = source.slice(source.indexOf('const deleteAllHistory'));
    assert.ok(body.indexOf('markHistoryCleared(') > 0 && body.lastIndexOf('markHistoryCleared(', body.indexOf('prisma.aiOperation.deleteMany')) > 0
        && body.lastIndexOf('markHistoryCleared(', body.indexOf('prisma.aiOperation.deleteMany')) < body.indexOf('prisma.aiOperation.deleteMany'),
        'the clear is recorded before anything is deleted, for users and for guests');
});
