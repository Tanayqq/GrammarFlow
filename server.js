require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const aiRoutes = require('./src/routes/ai.routes');

// Initialize background queue workers
require('./src/worker');        // ai-jobs queue (grammar-fix, summarize, explain)
require('./src/historyWorker'); // ai-history queue (async DB logging)

const app = express();
const PORT = process.env.PORT || 3000;
const startTime = Date.now();

// 1. Production-ready CORS (Stabilized for Phase 3)
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

app.use(express.json());

// 2. Custom Lightweight Logger (Enhanced)
app.use((req, res, next) => {
    const start = Date.now();
    const origin = req.headers.origin || 'No Origin';
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const method = req.method;
        const url = req.originalUrl;
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

// 5. API Routes
app.use('/api/v1', aiRoutes);

// 6. Static Frontend Serving (Phase 3 Unified Architecture)
// Serves the web app from the public directory
app.use(express.static(path.join(__dirname, 'public')));

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
            message: err.message || 'Internal Server Error',
            code: err.code || 'SERVER_ERROR'
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
