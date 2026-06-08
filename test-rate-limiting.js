require('dotenv').config();
const http = require('http');
const app = require('./server');
const aiService = require('./src/services/ai.service');
const { redisConnection } = require('./src/queue');
const { generateCacheKey } = require('./src/utils/cacheKey');
const prompts = require('./src/config/prompts');

// 1. Mock Groq API call in aiService to avoid network calls/costs
aiService.callGroqAPI = async (prompt, text, temp) => {
    console.log(`[TEST MOCK] callGroqAPI called. Prompt length: ${prompt.length}`);
    return { text: "1. Corrected rewrite option one\n2. Corrected rewrite option two\n3. Corrected rewrite option three", source: "groq" };
};

const PORT = 3001;
let server;

function startServer() {
    return new Promise((resolve) => {
        server = app.listen(PORT, '127.0.0.1', () => {
            console.log(`[TEST SERVER] Running on port ${PORT}`);
            resolve();
        });
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                console.log('[TEST SERVER] Stopped');
                resolve();
            });
        } else {
            resolve();
        }
    });
}

// Helper to make POST requests
function makeRequest(path, headers, body) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);
        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed = {};
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = { raw: data };
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('=== STARTING RATE LIMITING VERIFICATION TESTS ===');
    
    // Ensure Redis connection is established
    if (redisConnection.status !== 'ready') {
        console.log('Waiting for Redis connection...');
        await new Promise((resolve) => redisConnection.once('ready', resolve));
    }

    try {
        // --- TEST 1: AI Rate Limiting & User Isolation ---
        console.log('\n--- Test 1: AI Rate Limiting & User Isolation ---');
        const sessionA = 'test-session-a-' + Date.now();
        const sessionB = 'test-session-b-' + Date.now();

        // Clear existing Redis keys for these sessions to start clean
        await redisConnection.del(`gf:limiter:ai:${sessionA}`);
        await redisConnection.del(`gf:limiter:ai:${sessionB}`);

        console.log(`Sending 15 requests for Session A: ${sessionA}...`);
        for (let i = 1; i <= 15; i++) {
            const res = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionA }, {
                text: `Hello world request ${i}`,
                style: 'Casual',
                tone: 'Friendly',
                language: 'English',
                humanize: false
            });
            if (res.status !== 200) {
                throw new Error(`Request ${i} failed prematurely with status ${res.status}`);
            }
        }
        console.log('✓ Sent 15 successful requests for Session A.');

        console.log('Sending 16th request for Session A (should be blocked)...');
        const blockedRes = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionA }, {
            text: 'Hello world blocked request',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English',
            humanize: false
        });

        console.log(`Status code: ${blockedRes.status} (Expected: 429)`);
        console.log(`Response body:`, blockedRes.body);
        console.log(`Retry-After Header:`, blockedRes.headers['retry-after']);

        if (blockedRes.status !== 429) {
            throw new Error(`Expected 429 but got ${blockedRes.status}`);
        }
        if (!blockedRes.body.error || typeof blockedRes.body.retryAfter !== 'number') {
            throw new Error(`Response body format incorrect: ${JSON.stringify(blockedRes.body)}`);
        }
        console.log('✓ Session A blocked correctly.');

        console.log(`Sending request for Session B: ${sessionB} (should succeed)...`);
        const sessionBRes = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionB }, {
            text: 'Hello world from session B',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English',
            humanize: false
        });
        console.log(`Status code: ${sessionBRes.status} (Expected: 200)`);
        if (sessionBRes.status !== 200) {
            throw new Error(`Expected 200 for Session B but got ${sessionBRes.status}`);
        }
        console.log('✓ User Isolation verified successfully.');


        // --- TEST 2: Cache Hit Bypass ---
        console.log('\n--- Test 2: Cache Hit Bypass ---');
        const sessionC = 'test-session-c-' + Date.now();
        await redisConnection.del(`gf:limiter:ai:${sessionC}`);

        const textInput = 'This is a unique text to cache';
        const prompt = prompts.getRewritePrompt('Casual', 'Friendly', 'English', false);
        const cacheKey = generateCacheKey(prompt, textInput);

        console.log(`Pre-populating Redis cache for key: ${cacheKey}`);
        const mockCachedResponse = "1. Cached alternative version one\n2. Cached alternative version two\n3. Cached alternative version three";
        await redisConnection.set(cacheKey, mockCachedResponse);

        console.log('Sending 20 requests to /rewrite (cache hits)...');
        for (let i = 1; i <= 20; i++) {
            const res = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionC }, {
                text: textInput,
                style: 'Casual',
                tone: 'Friendly',
                language: 'English',
                humanize: false
            });
            if (res.status !== 200) {
                throw new Error(`Cache hit request ${i} failed with status ${res.status}`);
            }
            if (res.body.metadata?.source !== 'cache') {
                throw new Error(`Expected source to be 'cache' but got ${res.body.metadata?.source}`);
            }
        }
        console.log('✓ Sent 20 requests. All succeeded and bypassed rate limits due to Cache Hits.');

        // Clean up the cache key
        await redisConnection.del(cacheKey);


        // --- TEST 3: IP Fallback ---
        console.log('\n--- Test 3: IP Fallback Rate Limiting ---');
        // Clear rate limiter for IP 127.0.0.1
        await redisConnection.del('gf:limiter:ai:127.0.0.1');

        console.log('Sending 16 requests without guest session header (IP fallback)...');
        let got429 = false;
        for (let i = 1; i <= 16; i++) {
            const res = await makeRequest('/api/v1/rewrite', {}, {
                text: `IP request ${i}`,
                style: 'Casual',
                tone: 'Friendly',
                language: 'English',
                humanize: false
            });
            if (res.status === 429) {
                console.log(`✓ Request ${i} blocked by IP fallback rate limiter.`);
                got429 = true;
                break;
            }
        }
        if (!got429) {
            throw new Error('IP rate limiter did not block requests after exceeding quota.');
        }


        // --- TEST 4: Redis Outage Fallback ---
        console.log('\n--- Test 4: Redis Outage Fallback (In-Memory) ---');
        const sessionD = 'test-session-d-' + Date.now();
        
        // Mock redisConnection failure
        const originalStatus = redisConnection.status;
        Object.defineProperty(redisConnection, 'status', { value: 'disconnected', writable: true });
        console.log('Mended redisConnection status to "disconnected"');

        console.log('Sending 15 requests (should succeed on memory fallback)...');
        for (let i = 1; i <= 15; i++) {
            const res = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionD }, {
                text: `Memory request ${i}`,
                style: 'Casual',
                tone: 'Friendly',
                language: 'English',
                humanize: false
            });
            if (res.status !== 200) {
                throw new Error(`Fallback request ${i} failed with status ${res.status}`);
            }
        }
        console.log('✓ Sent 15 successful requests on in-memory fallback.');

        console.log('Sending 16th request on memory fallback (should be blocked)...');
        const memoryBlocked = await makeRequest('/api/v1/rewrite', { 'x-guest-session-id': sessionD }, {
            text: 'Memory blocked request',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English',
            humanize: false
        });
        console.log(`Memory fallback blocked status code: ${memoryBlocked.status} (Expected: 429)`);
        if (memoryBlocked.status !== 429) {
            throw new Error(`Expected 429 on memory fallback but got ${memoryBlocked.status}`);
        }
        console.log('✓ Redis Outage Fallback verified successfully.');

        // Restore Redis connection status
        Object.defineProperty(redisConnection, 'status', { value: originalStatus, writable: true });
        console.log('Restored redisConnection status to original');

        console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
    } catch (e) {
        console.error('\n❌ TEST RUN FAILED:', e.message);
        process.exitCode = 1;
    }
}

// Run sequence
(async () => {
    await startServer();
    await runTests();
    await stopServer();
    process.exit();
})();
