require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const aiRoutes = require('./src/routes/ai.routes');

// Initialize background queue workers
if (process.env.ENABLE_BACKGROUND_QUEUES === 'true') require('./src/worker');
require('./src/historyWorker'); // ai-history queue (async DB logging)
require('./src/historyRetention').start(); // old history expires (see HISTORY_GUEST_DAYS / HISTORY_USER_DAYS)

const app = express();
if (process.env.RENDER === 'true') app.set('trust proxy', require('./src/config/trustedProxies'));
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const startTime = Date.now();

// 1. Production-ready CORS (Stabilized for Phase 3)
app.use(cors(require('./src/config/cors')));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.RENDER === 'true') res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
});

app.use('/api/v1/dev-editor/assist', express.json({limit:'512kb'}));
app.use('/api/v1/dev-editor/execute', express.json({limit:'512kb'}));
app.use('/api/v1/transcribe', require('./src/middlewares/transcribeGate'), express.raw({ type: 'audio/*', limit: '5mb' }));
app.use(express.json());

// 2. Custom Lightweight Logger (Enhanced)
app.use((req, res, next) => {
    const start = Date.now();
    const origin = req.headers.origin || 'No Origin';
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const method = req.method;
        const url = req.path; // Query strings may contain tokens; never write them to access logs.
        const timestamp = new Date().toISOString();
        const statusColor = status >= 400 ? '\x1b[31m' : '\x1b[32m';
        console.log(`[\x1b[36m${timestamp}\x1b[0m] ${method} ${url} ${statusColor}${status}\x1b[0m - ${duration}ms - Origin: ${origin}`);
    });
    next();
});

// 3. Consolidated Health & Diagnostics
const getHealthStatus = () => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const memory = process.memoryUsage();
    return {
        success: true,
        data: {
            status: 'UP',
            uptime: `${uptimeSeconds}s`,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            version: '1.3.0',
            system: {
                nodeVersion: process.version,
                memoryUsage: {
                    rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
                    heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`
                }
            }
        }
    };
};

app.get('/api/v1/health', (req, res) => res.json(getHealthStatus()));
app.get('/health', (req, res) => res.json(getHealthStatus()));

// 4. Rate Limiting Protection (Global Safety-Net Sliding-Window)
const { passiveAuth } = require('./src/middlewares/auth');
const { globalSafetyLimiter } = require('./src/middlewares/rateLimiter');
app.use('/api', passiveAuth, globalSafetyLimiter);

// Public readiness reports only availability, never database errors or account counts. It sits behind the global
// limiter and remembers its answer for 10 seconds, so a flood of calls cannot use up the database connections.
let dbHealth = { at: 0, ok: false };
let dbHealthCheck = null; // the check in progress, shared by every caller that arrives while it runs
let lastDbHealthLog = 0;
const checkDatabase = async () => {
    try {
        await require('./src/db').$queryRaw`SELECT 1`;
        dbHealth = { at: Date.now(), ok: true };
    } catch (err) {
        dbHealth = { at: Date.now(), ok: false };
        if (Date.now() - lastDbHealthLog > 60000) {
            lastDbHealthLog = Date.now();
            console.error('[DB HEALTH] Database check failed:', err.code || err.name, err.message, require('./src/utils/databaseError').databaseHint(err));
        }
    }
};
app.get('/api/v1/db-health', async (req, res) => {
    if (Date.now() - dbHealth.at >= 10000) {
        dbHealthCheck ||= checkDatabase().finally(() => { dbHealthCheck = null; });
        await dbHealthCheck;
    }
    if (dbHealth.ok) return res.json({ success: true, data: { db: 'connected' } });
    res.status(503).json({ success: false, data: { db: 'unavailable' } });
});


// 5. API Routes
app.use('/api/v1', aiRoutes);

// 6. Static Frontend Serving (Phase 3 Unified Architecture)
// Serves the web app from the public directory
// Force no-cache on ALL static files so browsers never serve stale JS/CSS
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Fallback to index.html for SPA-like behavior (Phase 3 Final Middleware)
app.use((req, res) => {
    if (req.url.startsWith('/api')) return res.status(404).json({ success: false, error: { message: 'API route not found' } });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6. Global Error Handling
app.use((err, req, res, next) => {
    console.error(`[\x1b[31mERROR\x1b[0m] ${new Date().toISOString()} - ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        error: {
            message: err.type === 'entity.parse.failed' ? 'Invalid JSON request.' :
                err.type === 'entity.too.large' ? 'This request is too large. Please use a shorter passage.' : 'Something went wrong. Please try again shortly.',
            code: 'REQUEST_FAILED'
        }
    });
});

// 7. Start Server
if (process.env.NODE_ENV !== 'production' || require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[36m%s\x1b[0m`, `--------------------------------------------------`);
        console.log(`\x1b[32m%s\x1b[0m`, `GrammarFlow Production Backend Active!`);
        console.log(`\x1b[33m%s\x1b[0m`, `Port: ${PORT} | Mode: ${process.env.NODE_ENV || 'development'}`);
        console.log(`\x1b[36m%s\x1b[0m`, `--------------------------------------------------`);
    });
}

module.exports = app;
