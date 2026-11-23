const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const load = require('./load-module');

const limiters = load('src/middlewares/rateLimiter.js', { '../queue': { redisConnection: { status: 'end' } } }, { console: { log() {}, warn() {}, error() {} } });
const skipped = (url) => {
    const [pathname] = url.split('?');
    return limiters.skipGlobalLimit({ baseUrl: '/api', path: pathname.replace(/^\/api/, ''), originalUrl: url });
};

test('the global limiter skips only the health probe and routes that have their own limiter', () => {
    assert.equal(skipped('/api/v1/health'), true);
    for (const route of ['/rewrite', '/grammar-fix', '/suggestions', '/autocomplete', '/analyze-realtime', '/analyze-smart', '/process-document', '/history', '/dev-editor/assist', '/dev-editor/execute']) {
        assert.equal(skipped('/api/v1' + route), true, route);
    }
    assert.equal(skipped('/api/v1/history/abc123'), true, 'history detail has the read limiter');
    assert.equal(skipped('/api/v1/job/xyz'), true);
});

test('a query string or a look-alike path cannot switch the global limit off', () => {
    for (const url of [
        '/api/v1/db-health', '/api/v1/db-health?x=/health', '/api/v1/db-health?x=/status', '/api/v1/auth/sync?/webhook',
        '/api/v1/auth/config?/health', '/api/v1/auth/login?next=/rewrite', '/api/v1/health/../auth/sync',
        '/api/v1/rewrite-evil', '/api/v1/jobs', '/api/v1/historyx', '/api/v1/auth/health'
    ]) assert.equal(skipped(url), false, url);
});

test('the database check sits behind the global limiter and remembers its answer', () => {
    const server = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const limiterAt = server.indexOf("app.use('/api', passiveAuth, globalSafetyLimiter)");
    const dbHealthAt = server.indexOf("app.get('/api/v1/db-health'");
    assert.ok(limiterAt > 0 && dbHealthAt > limiterAt, 'registered after the limiter, so it is limited');
    assert.equal(server.split("'/api/v1/db-health'").length - 1, 1, 'registered once');
    const region = server.slice(server.indexOf('let dbHealth'), dbHealthAt + 700);
    assert.match(region, /10000/, 'the answer is kept for 10 seconds');
    assert.match(region, /dbHealthCheck \|\|=/, 'callers that arrive while a check runs share it');
});
