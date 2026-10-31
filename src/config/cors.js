const productionOrigins = [
    'https://grammarflowt.vercel.app',
    'https://grammarflow-brain.onrender.com'
];

module.exports = {
    origin(origin, callback) {
        const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
        const localDevelopment = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
        // CORS governs browser access, not authentication or non-browser clients.
        callback(null, !origin || productionOrigins.includes(origin) || configured.includes(origin) || localDevelopment);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-session-id', 'Cache-Control', 'Pragma'],
    credentials: false
};
