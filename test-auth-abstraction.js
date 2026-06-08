require('dotenv').config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const http = require('http');
const app = require('./server');
const authService = require('./src/services/auth/AuthService');
const aiService = require('./src/services/ai.service');
const prisma = require('./src/db');
const { redisConnection } = require('./src/queue');

// Mock Groq API
aiService.callGroqAPI = async (prompt, text, temp) => {
    return { text: "Mocked AI output text", source: "groq" };
};

const PORT = 3002;
let server;

function startServer() {
    return new Promise((resolve) => {
        server = app.listen(PORT, '127.0.0.1', () => {
            console.log(`[AUTH TEST SERVER] Running on port ${PORT}`);
            resolve();
        });
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                console.log('[AUTH TEST SERVER] Stopped');
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
        const postData = JSON.stringify(body || {});
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
    console.log('=== STARTING AUTH ABSTRACTION VERIFICATION TESTS ===');
    
    try {
        // --- TEST 1: Passive Authentication (Guest request) ---
        console.log('\n--- Test 1: Passive Auth (Guest Access) ---');
        // Sending request to /rewrite without headers. Should run in Guest Mode and succeed.
        const guestRes = await makeRequest('/api/v1/rewrite', {}, {
            text: 'Hello guest world',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English'
        });
        console.log(`Status code: ${guestRes.status} (Expected: 200)`);
        if (guestRes.status !== 200) {
            throw new Error(`Guest request failed with status ${guestRes.status}`);
        }
        console.log('✓ Passive Auth verified: Guest requests proceed normally.');

        // --- TEST 2: Passive Authentication (Sync route without Auth) ---
        console.log('\n--- Test 2: Protected Controller Endpoint (Sync without Auth) ---');
        // /sync requires auth. Since we pass no token, it should fail with 401.
        const guestSyncRes = await makeRequest('/api/v1/auth/sync', {}, { guestSessionId: 'guest_123' });
        console.log(`Status code: ${guestSyncRes.status} (Expected: 401)`);
        if (guestSyncRes.status !== 401) {
            throw new Error(`Expected 401 for unauthorized sync but got ${guestSyncRes.status}`);
        }
        console.log('✓ Unauthenticated sync request rejected correctly.');

        // --- TEST 3: Resilient Fallback (Config missing / Provider Outage) ---
        console.log('\n--- Test 3: Resilient Fallback (Expired Token / Missing Config) ---');
        // Sending a token when Clerk is unconfigured will fail token verification.
        // It must NOT block the request, it should just log a warning and proceed in Guest Mode.
        const expiredRes = await makeRequest('/api/v1/rewrite', { 'Authorization': 'Bearer invalid_or_expired_token' }, {
            text: 'Hello offline world',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English'
        });
        console.log(`Status code: ${expiredRes.status} (Expected: 200)`);
        if (expiredRes.status !== 200) {
            throw new Error(`Failed token request was blocked. Status: ${expiredRes.status}`);
        }
        console.log('✓ Resilient Fallback verified: Token failures degrade gracefully to Guest Mode.');


        // --- TEST 4: Successful Authentication (Mocked Provider) ---
        console.log('\n--- Test 4: Successful Authentication (Mocked Provider) ---');
        
        // Mock token verification in AuthService
        const mockUser = { id: 'mock_user_id_123', email: 'user@example.com', name: 'John Doe' };
        const originalVerifyToken = authService.verifySessionToken;
        authService.verifySessionToken = async (token) => {
            if (token === 'valid_mock_token') {
                return mockUser;
            }
            return null;
        };

        const authRes = await makeRequest('/api/v1/rewrite', { 'Authorization': 'Bearer valid_mock_token' }, {
            text: 'Hello authenticated world',
            style: 'Casual',
            tone: 'Friendly',
            language: 'English'
        });
        console.log(`Status code: ${authRes.status} (Expected: 200)`);
        if (authRes.status !== 200) {
            throw new Error(`Authenticated request failed with status ${authRes.status}`);
        }
        console.log('✓ Authentication successful using mocked AuthService provider.');


        // --- TEST 5: Session Migration (Database Sync) ---
        console.log('\n--- Test 5: Session Migration (Database Sync Transaction) ---');
        const guestSessionId = 'guest_session_' + Date.now();
        const testAuthUserId = 'auth_user_' + Date.now();
        
        // Setup mock AuthService returning our test user
        authService.verifySessionToken = async (token) => {
            if (token === 'valid_sync_token') {
                return { id: testAuthUserId, email: 'sync-user@example.com', name: 'Sync User' };
            }
            return null;
        };

        // 1. Create a guest user, settings and operations in the DB
        console.log('Pre-populating guest user operations in DB...');
        const dbGuestUser = await prisma.user.create({
            data: {
                guest_session_id: guestSessionId,
                settings: {
                    create: { preferred_language: 'Spanish' }
                }
            }
        });

        await prisma.aiOperation.create({
            data: {
                user_id: dbGuestUser.id,
                input_text: 'Spanish translation input',
                output_text: 'Spanish translation output',
                operation_type: 'rewrite',
                status: 'success'
            }
        });

        // 2. Call the sync endpoint
        console.log('Calling /auth/sync endpoint to migrate session...');
        const syncRes = await makeRequest('/api/v1/auth/sync', { 'Authorization': 'Bearer valid_sync_token' }, {
            guestSessionId: guestSessionId
        });

        console.log(`Sync Status: ${syncRes.status} (Expected: 200)`);
        if (syncRes.status !== 200) {
            throw new Error(`Sync request failed with status ${syncRes.status}`);
        }

        // 3. Assert DB updates
        console.log('Asserting database updates...');
        
        // Assert guest user record has been deleted
        const checkGuestUser = await prisma.user.findUnique({
            where: { guest_session_id: guestSessionId }
        });
        // Note: The guest_session_id is now assigned to the auth user, so it should resolve to the auth user!
        if (!checkGuestUser) {
            throw new Error('Expected guest_session_id to resolve to the new authenticated user, but it was null.');
        }
        if (checkGuestUser.id !== testAuthUserId) {
            throw new Error(`Expected guest_session_id to link to user "${testAuthUserId}", but got "${checkGuestUser.id}"`);
        }
        console.log('✓ Guest session ID successfully linked to authenticated user.');

        // Assert operations migrated
        const checkOps = await prisma.aiOperation.findMany({
            where: { user_id: testAuthUserId }
        });
        console.log(`Found ${checkOps.length} operations migrated (Expected: 1)`);
        if (checkOps.length !== 1) {
            throw new Error(`Expected 1 migrated operation but found ${checkOps.length}`);
        }
        console.log('✓ Guest operations successfully migrated to authenticated user ID.');

        // Assert settings migrated/linked
        const checkSettings = await prisma.userSettings.findUnique({
            where: { user_id: testAuthUserId }
        });
        if (!checkSettings || checkSettings.preferred_language !== 'Spanish') {
            throw new Error(`Expected settings to migrate with language 'Spanish', but got: ${JSON.stringify(checkSettings)}`);
        }
        console.log('✓ Guest user settings successfully migrated to authenticated user ID.');

        // Clean up test data
        await prisma.userSettings.delete({ where: { user_id: testAuthUserId } }).catch(() => {});
        await prisma.aiOperation.deleteMany({ where: { user_id: testAuthUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: testAuthUserId } }).catch(() => {});
        
        // Restore AuthService
        authService.verifySessionToken = originalVerifyToken;

        console.log('\n=== ALL AUTH TESTS PASSED SUCCESSFULLY! ===');
    } catch (e) {
        console.error('\n❌ AUTH TEST RUN FAILED:', e.message);
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
