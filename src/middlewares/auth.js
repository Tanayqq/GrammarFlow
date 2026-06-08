const authService = require('../services/auth/AuthService');

/**
 * Passive Auth Middleware.
 * Inspects requests for an Authorization Bearer token.
 * If verified, attaches req.user and req.userId.
 * NEVER blocks requests or throws 401/403 errors, ensuring Guest Mode is the ultimate fallback.
 */
async function passiveAuth(req, res, next) {
    req.user = null;
    req.userId = null;

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token) {
            const user = await authService.verifySessionToken(token);
            if (user) {
                req.user = user;
                req.userId = user.id;
                console.log(`[AUTH MIDDLEWARE] Authenticated Request. User ID: ${user.id}`);
            }
        }
    }

    next();
}

module.exports = {
    passiveAuth
};
