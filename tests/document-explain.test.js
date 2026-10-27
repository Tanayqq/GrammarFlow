const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-module');
const prompts = require('../src/config/prompts');
const { isRomanHinglish } = require('../src/utils/documentLanguage');
const english = 'Imagine a secret key hidden inside a large castle. Each person uses the public key to calculate the same shared secret. The attacker cannot easily find the private value from the public information. This is a mathematical problem with important security assumptions.';
const hinglish = 'ECDH mein dono log apni private key ko secret rakhte hain. Public keys ki madad se dono ek shared secret banate hain. Iski security kuch mathematical assumptions par depend karti hai; iska matlab yeh nahi ki har attack se protection ki guarantee hai.';

test('document Hinglish check rejects English, English with Hindi outro, and Devanagari', () => {
    assert.equal(isRomanHinglish(english), false);
    assert.equal(isRomanHinglish(english + '\n\nBas, yeh clear hai aur samajh aa gaya.'), false);
    assert.equal(isRomanHinglish('यह आसान है और समझ में आता है।'), false);
    assert.equal(isRomanHinglish(hinglish), true);
});

test('explain prompt requires source fidelity and Hinglish in every paragraph without forced toy diagrams', () => {
    const prompt = prompts.getDocumentProcessingPrompt('Explain', 'Hinglish', 'Casual', 'Friendly', true);
    assert.match(prompt, /EVERY explanatory paragraph/);
    assert.match(prompt, /at most 400 words/);
    assert.match(prompt, /Preserve numbers, conditions, assumptions and uncertainty/);
    assert.match(prompt, /Do not invent diagrams/);
    assert.doesNotMatch(prompt, /fun ASCII box diagram|100% accurate/);
});

function controller(responses) {
    let calls = 0;
    const module = load('src/controllers/ai.controller.js', {
        '../services/ai.service': { callGroqAPI: async () => ({ text: responses[calls++], source: 'test' }) },
        '../queue': {}, '../historyQueue': {}, '../historyWorker': {}, '../db': {}
    });
    return { module, count: () => calls };
}
async function run(api, cached) {
    let response, status = 200;
    await api.module.processDocument({ body: { text: 'Source excerpt.', mode: 'Explain', language: 'Hinglish' }, headers: {},
        isCacheHit: !!cached, cachedResponse: cached }, {
        status(n) { status = n; return this; }, json(body) { response = body; return this; }, setHeader() {}
    });
    return { status, response };
}
test('wrong-language explanation is repaired once before being accepted', async () => {
    const api = controller([english, hinglish]);
    const result = await run(api);
    assert.equal(api.count(), 2); assert.equal(result.status, 200);
    assert.equal(result.response.data[0], hinglish);
});
test('invalid cached language is checked, and repeated mismatch fails closed', async () => {
    const api = controller([english]);
    const result = await run(api, english);
    assert.equal(api.count(), 1); assert.equal(result.status, 422);
    assert.equal(result.response.error.code, 'DOCUMENT_LANGUAGE_MISMATCH');
    assert.equal(result.response.data, undefined);
});
