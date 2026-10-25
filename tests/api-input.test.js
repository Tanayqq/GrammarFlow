const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const load = require('./load-module');

test('AI routes reject malformed inputs before calling providers or queues', async t => {
    let providerCalls = 0;
    const controller = load('src/controllers/ai.controller.js', {
        '../services/ai.service': { callGroqAPI: async () => {
            providerCalls++;
            return { text: '{"result":{"corrected_text":"Fixed."}}', source: 'test' };
        } },
        '../queue': { aiQueue: {}, redisConnection: { status: 'end' } },
        '../historyQueue': { aiHistoryQueue: {} },
        '../historyWorker': { logHistoryRecord() {} },
        '../db': {}
    }, { console: { log() {}, error() {}, warn() {} } });
    const pass = (req, res, next) => next();
    const router = load('src/routes/ai.routes.js', {
        '../controllers/ai.controller': controller,
        '../middlewares/cacheCheck': { aiCacheCheck: pass },
        '../middlewares/rateLimiter': { aiLimiter: pass, docLimiter: pass, readLimiter: pass },
        '../middlewares/auth': { passiveAuth: pass },
        './auth.routes': express.Router()
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const post = (endpoint, body) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    for (const endpoint of ['grammar-fix', 'rewrite', 'suggestions', 'analyze-realtime', 'analyze-smart', 'process-document', 'autocomplete']) {
        await t.test(endpoint, async () => {
            const field = endpoint === 'autocomplete' ? 'context' : 'text';
            for (const value of [null, {}, [], 7, true]) {
                const response = await post(endpoint, { [field]: value });
                assert.equal(response.status, 400, `${endpoint}: ${JSON.stringify(value)}`);
            }
            assert.equal((await post(endpoint, {})).status, 400);
        });
    }
    await t.test('nested options and length limits', async () => {
        for (const body of [{ text: 'Hello.', language: {} }, { text: 'Hello.', writingContext: null },
            { text: 'Hello.', humanize: 'false' }, { text: 'x'.repeat(50001) }]) {
            const response = await post('analyze-smart', body);
            assert.equal(response.status, body.text.length > 50000 ? 413 : 400);
        }
        assert.equal(providerCalls, 0);
    });
    await t.test('valid multilingual text reaches the real handler', async () => {
        const response = await post('rewrite', { text: 'मैं आज स्कूल जाता हूँ।', language: 'Hindi', humanize: false });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).success, true);
        assert.ok(providerCalls > 0);
    });
    for (const mode of ['Summarize', 'Explain', 'Grammar']) {
        await t.test(`valid document mode: ${mode}`, async () => {
            const response = await post('process-document', { text: 'A school library opens on Monday.', mode, language: 'English' });
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.success, true);
            assert.equal(body.metadata.mode, mode);
            assert.ok(body.data[0].length > 0);
        });
    }
});
