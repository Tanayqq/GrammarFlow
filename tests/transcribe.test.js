const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const load = require('./load-module');

process.env.GRAMMARFLOW_LOCAL_DEMO = 'true'; // no Redis needed for the service
process.env.GROQ_API_KEY = 'test-key';
const aiService = require('../src/services/ai.service');

test('transcribe sends audio to Groq Whisper and falls back to the next model', async t => {
    const calls = [];
    const realFetch = global.fetch;
    t.after(() => { global.fetch = realFetch; });
    global.fetch = async (url, init) => {
        calls.push({ url, model: init.body.get('model'), file: init.body.get('file'), auth: init.headers.Authorization });
        if (calls.length === 1) return new Response('{"error":{"message":"model not found"}}', { status: 404 });
        return new Response(JSON.stringify({ text: '  hello from my voice  ' }), { status: 200 });
    };
    const text = await aiService.transcribe(Buffer.from('fake-opus'), 'audio/webm');
    assert.equal(text, 'hello from my voice');
    assert.deepEqual(calls.map(c => c.model), ['whisper-large-v3-turbo', 'whisper-large-v3']);
    assert.match(calls[0].url, /\/audio\/transcriptions$/);
    assert.equal(calls[0].auth, 'Bearer test-key');
    assert.equal(calls[0].file.name, 'speech.webm');
});

test('transcribe reports rate limits as temporarily unavailable', async t => {
    const realFetch = global.fetch;
    t.after(() => { global.fetch = realFetch; });
    global.fetch = async () => new Response('{}', { status: 429, headers: { 'retry-after': '12' } });
    await assert.rejects(aiService.transcribe(Buffer.from('x'), 'audio/ogg'), e => e.status === 503 && e.retryAfter === 12);
});

test('/transcribe route validates audio type, emptiness and size', async t => {
    const controller = load('src/controllers/ai.controller.js', {
        '../services/ai.service': { AUDIO_TYPES: aiService.AUDIO_TYPES, transcribe: async (buf, type) => `${buf.length} bytes of ${type}` },
        '../queue': { aiQueue: {}, redisConnection: { status: 'end' } },
        '../historyQueue': { aiHistoryQueue: {} },
        '../historyWorker': { logHistoryRecord() {} },
        '../db': {}
    }, { console: { log() {}, error() {}, warn() {} } });
    const app = express();
    app.post('/transcribe', express.raw({ type: 'audio/*', limit: '5mb' }), controller.transcribe);
    app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    const post = (type, body) => fetch(`http://127.0.0.1:${server.address().port}/transcribe`, { method: 'POST', headers: { 'Content-Type': type }, body });

    const ok = await post('audio/webm;codecs=opus', Buffer.alloc(1000));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.text, '1000 bytes of audio/webm');
    assert.equal((await post('text/plain', 'hello')).status, 415);
    assert.equal((await post('audio/webm', Buffer.alloc(0))).status, 400);
    assert.equal((await post('audio/webm', Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
});

test('transcribe drains failed responses and keeps fallbacks inside one 40 s budget', async t => {
    const realFetch = global.fetch, realNow = Date.now;
    t.after(() => { global.fetch = realFetch; Date.now = realNow; });
    let clock = 1_000_000, cancelled = 0, calls = 0;
    Date.now = () => clock;
    global.fetch = async () => {
        calls++;
        clock += 39_500; // the first model used almost the whole budget
        return { ok: false, status: 500, headers: new Headers(), body: { cancel: async () => { cancelled++; } } };
    };
    await assert.rejects(aiService.transcribe(Buffer.from('x'), 'audio/webm'), e => e.status === 503);
    assert.equal(calls, 1, 'no second model once the budget is spent');
    assert.equal(cancelled, 1, 'failed response body was released');
});
