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

test('every route in the routers has a rate limiter of its own or sits behind the global one', () => {
    // Routes that run an AI model, send mail or touch history must name a limiter in their own registration.
    const own = /(aiLimiter|docLimiter|readLimiter|authLimiter|dictationLimiter|executionLimiter|feedbackLimiter)/;
    const exempt = new Set(['/sync', '/config']); // /sync is behind the global limiter and only reads the session
    let checked = 0;
    for (const file of ['src/routes/ai.routes.js', 'src/routes/auth.routes.js']) {
        const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
        for (const m of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'([^\n]*)/g)) {
            if (exempt.has(m[2])) continue;
            checked++;
            assert.match(m[3], own, `${file}: ${m[1].toUpperCase()} ${m[2]} has no limiter of its own`);
        }
    }
    assert.ok(checked >= 15, 'the route list was actually read');
});

test('the browser extension asks for the least it needs', () => {
    const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'GrammarFlow-Extension', 'manifest.json'), 'utf8'));
    assert.ok(!manifest.permissions.includes('tabs'), 'host access already covers tab addresses, so the tabs permission adds only warnings');
});

test('the public health probe reveals no environment, version or memory details', () => {
    const server = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const probe = server.slice(server.indexOf('const getHealthStatus'), server.indexOf("app.get('/api/v1/health'"));
    assert.doesNotMatch(probe, /process\.version|memoryUsage|NODE_ENV|version:/);
});

test('the limiter goes back to Redis after a quota outage instead of staying in memory until restart', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src', 'middlewares', 'rateLimiter.js'), 'utf8');
    assert.match(source, /redisDisabledUntil = Date\.now\(\) \+ REDIS_RETRY_MS/);
    assert.match(source, /Date\.now\(\) >= redisDisabledUntil/);
    assert.doesNotMatch(source, /isRedisRateLimiterDisabled/);
});

test('ts-node is no longer a dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.ok(!(pkg.dependencies || {})['ts-node'] && !(pkg.devDependencies || {})['ts-node']);
});
