const { test } = require('node:test');
const assert = require('node:assert/strict');
const cors = require('../src/config/cors');
test('browser origins are explicit in production and custom domains require configuration', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS };
    try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_ORIGINS = 'https://writing.example';
        const allowed = origin => { let result; cors.origin(origin, (error, value) => { assert.equal(error, null); result = value; }); return result; };
        assert.equal(allowed('https://grammarflowt.vercel.app'), true);
        assert.equal(allowed('https://writing.example'), true);
        assert.equal(allowed('https://grammarflowt.vercel.app.evil.example'), false);
        assert.equal(allowed('https://untrusted.example'), false);
        assert.equal(allowed('http://localhost:3000'), false);
        assert.equal(allowed('null'), false);
        assert.ok(cors.allowedHeaders.includes('Cache-Control'));
        assert.ok(cors.allowedHeaders.includes('Pragma'));
        assert.equal(allowed(undefined), true);
        process.env.NODE_ENV = 'development';
        assert.equal(allowed('http://localhost:3000'), true);
        assert.equal(allowed('http://localhost.evil.example:3000'), false);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
