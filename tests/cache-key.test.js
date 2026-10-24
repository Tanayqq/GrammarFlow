const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateCacheKey } = require('../src/utils/cacheKey');

test('cache keys separate prompt and user text even when they contain colons', () => {
    assert.notEqual(generateCacheKey('a:b', 'c'), generateCacheKey('a', 'b:c'));
    assert.notEqual(generateCacheKey('a', ':b'), generateCacheKey('a:', 'b'));
    assert.equal(generateCacheKey('prompt', 'text'), generateCacheKey('prompt', 'text'));
    assert.match(generateCacheKey('', ''), /^gf:cache:[a-f0-9]{64}$/);
});
