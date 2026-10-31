const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-module');
const quiet = { log() {}, warn() {}, error() {} };
const success = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const service = (fetch, globals = {}, redis = { status: 'end' }) => load('src/services/ai.service.js', {
    '../queue': { redisConnection: redis }
}, { fetch, AbortController, console: quiet, process: { env: { GROQ_API_KEY: 'synthetic-key' } }, ...globals });

test('optional output budgets reach the provider and have separate cache entries', async () => {
    const bodies=[];
    const ai=service(async(url,request)=>{bodies.push(JSON.parse(request.body));return success('Explanation.');});
    await ai.callGroqAPI('p','t',.2,{maxTokens:700});
    await ai.callGroqAPI('p','t',.2,{maxTokens:900});
    await ai.callGroqAPI('p','t',.2,{maxTokens:700});
    assert.equal(bodies.length,2);
    assert.deepEqual(bodies.map(body=>body.max_completion_tokens),[700,900]);
    await ai.callGroqAPI('p','t',.2);
    assert.equal(bodies[2].max_completion_tokens,undefined);
});

test('provider throttling falls back, deduplicates identical work and caches successful results', async () => {
    let calls = 0;
    const ai = service(async () => ++calls === 1 ? new Response('private provider details', {
        status: 429, headers: { 'Retry-After': '120' }
    }) : success('Corrected.'));
    const results = await Promise.all(Array.from({ length: 20 }, () => ai.callGroqAPI('prompt', 'text')));
    assert.equal(calls, 2);
    assert.ok(results.every(result => result.text === 'Corrected.'));
    assert.equal((await ai.callGroqAPI('prompt', 'text')).source, 'cache');
    assert.equal(calls, 2);
    await ai.callGroqAPI('prompt', 'different');
    assert.equal(calls, 3); // Cooling-down model is skipped.
});

test('all-model throttling respects cooldown without retry storms or internal error leakage', async () => {
    let calls = 0;
    const ai = service(async () => { calls++; return new Response('secret-key-and-private-input', {
        status: 429, headers: { 'Retry-After': '90' }
    }); });
    for (let i = 0; i < 5; i++) await assert.rejects(ai.callGroqAPI('prompt', String(i)), error => {
        assert.equal(error.status, 503);
        assert.ok(error.retryAfter >= 89);
        assert.doesNotMatch(error.message, /secret|private|limit|Groq/);
        return true;
    });
    assert.equal(calls, 3);
});

test('bad credentials stop immediately and do not rotate through more keys', async () => {
    let calls = 0;
    const ai = service(async () => { calls++; return new Response('credential details', { status: 401 }); },
        { process: { env: { GROQ_API_KEY: 'first-key,second-key' } } });
    await assert.rejects(ai.callGroqAPI('p', 't'), /temporarily busy/);
    await assert.rejects(ai.callGroqAPI('p', 'u'), /temporarily busy/);
    assert.equal(calls, 1);
});

test('concurrent distinct requests have a fixed resource ceiling and recover after completion', async () => {
    const releases = [];
    const ai = service(() => new Promise(resolve => releases.push(() => resolve(success('Done.')))));
    const active = Array.from({ length: 4 }, (_, i) => ai.callGroqAPI('p', String(i)));
    await assert.rejects(ai.callGroqAPI('p', 'overflow'), error => error.status === 503 && error.retryAfter === 10);
    assert.equal(releases.length, 4);
    releases.forEach(release => release());
    await Promise.all(active);
    const next = ai.callGroqAPI('p', 'new');
    releases[4]();
    assert.equal((await next).text, 'Done.');
});

test('provider deadlines abort stalled bodies and release concurrency slots', async () => {
    let aborts = 0;
    const ai = service(async (url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); });
    }) }), { setTimeout: fn => setTimeout(fn, 5) });
    await assert.rejects(ai.callGroqAPI('p', 't'), /temporarily busy/);
    assert.equal(aborts, 3);
    await assert.rejects(ai.callGroqAPI('p', 'next'), /temporarily busy/);
    assert.equal(aborts, 6);
});

test('cache outage does not block AI and cache keys include response format', async () => {
    let reads = 0, calls = 0;
    const ai = service(async () => { calls++; return success('Result'); }, {}, {
        status: 'ready', get: async () => { reads++; throw new Error('Redis quota'); }
    });
    await ai.callGroqAPI('p', 't');
    await ai.callGroqAPI('p', 't', 0.7, { responseFormat: 'json' });
    assert.equal(reads, 1);
    assert.equal(calls, 2);
});

function controller(provider, job) {
    return load('src/controllers/ai.controller.js', {
        '../services/ai.service': { callGroqAPI: provider },
        '../queue': { aiQueue: job ? { getJob: async () => job } : null, redisConnection: { status: 'end' } },
        '../historyQueue': { aiHistoryQueue: {} }, '../historyWorker': { logHistoryRecord() {} }, '../db': {}
    }, { console: quiet });
}
function response() {
    return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('all AI handlers redact internal failures and return retryable HTTP 503', async () => {
    let calls = 0;
    const handlers = controller(async () => { calls++; throw new Error('gsk_sensitive database-password user-text'); });
    for (const name of ['rewrite', 'grammarFix', 'suggestions', 'autocomplete', 'analyzeRealtime', 'analyzeSmartSuggestions', 'processDocument']) {
        const res = response();
        await handlers[name]({ body: { text: 'A sufficiently long sentence.', context: 'A context.' }, headers: {} }, res);
        assert.equal(res.statusCode, 503, name);
        assert.equal(res.headers['Retry-After'], '30');
        assert.doesNotMatch(JSON.stringify(res.body), /gsk_|password|user-text/);
    }
    assert.equal(calls, 7);
});

test('queued results require the owning account or guest identifier', async () => {
    const job = { data: { user_id: 'owner' }, getState: async () => 'completed', returnvalue: { text: 'private result' } };
    const handlers = controller(null, job);
    for (const userId of [null, 'other', 'owner']) {
        const res = response();
        await handlers.checkJobStatus({ params: { jobId: '1' }, headers: {}, userId }, res);
        assert.equal(res.statusCode, userId === 'owner' ? 200 : 404);
    }
    job.data = { guest_session_id: 'unguessable-guest' };
    for (const guest of ['', 'other', 'unguessable-guest']) {
        const res = response();
        await handlers.checkJobStatus({ params: { jobId: '1' }, headers: { 'x-guest-session-id': guest } }, res);
        assert.equal(res.statusCode, guest === 'unguessable-guest' ? 200 : 404);
    }
});

test('trusted Render proxy chains keep visitors distinct and ignore forged leftmost IPs', () => {
    const proxyaddr = require('proxy-addr');
    const trust = proxyaddr.compile(require('../src/config/trustedProxies'));
    const client = forwarded => proxyaddr({ socket: { remoteAddress: '10.0.0.5' }, headers: { 'x-forwarded-for': forwarded } }, trust);
    assert.equal(client('192.0.2.10, 172.64.0.2, 10.0.0.4'), '192.0.2.10');
    assert.equal(client('198.51.100.9, 192.0.2.10, 172.64.0.2, 10.0.0.4'), '192.0.2.10');
    assert.notEqual(client('192.0.2.10, 172.64.0.2'), client('192.0.2.11, 172.64.0.2'));
    assert.equal(proxyaddr({ socket: { remoteAddress: '192.0.2.99' }, headers: { 'x-forwarded-for': '198.51.100.9' } }, trust), '192.0.2.99');
});

test('rejected language output is not cached and an immediate retry can generate a valid result', async () => {
    let calls = 0, writes = 0;
    const ai = service(async () => success(++calls === 1 ? 'English output.' : 'Yeh Hinglish mein hai.'), {}, {
        status: 'ready', get: async () => 'English output.', set: async () => writes++
    });
    const options = { validate: text => text.includes('Hinglish') };
    assert.equal((await ai.callGroqAPI('explain', 'source', .2, options)).text, 'English output.');
    assert.equal(writes, 0);
    assert.equal((await ai.callGroqAPI('explain', 'source', .2, options)).text, 'Yeh Hinglish mein hai.');
    assert.equal(calls, 2); assert.equal(writes, 1);
    assert.equal((await ai.callGroqAPI('explain', 'source', .2, options)).source, 'cache');
});
