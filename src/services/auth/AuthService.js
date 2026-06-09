const ClerkAuthProvider = require('./ClerkAuthProvider');

/**
 * AuthService wrapper.
 * Decouples the application code from identity providers and implements resilient timeouts.
 * If authentication fails or times out, it degrades gracefully to Guest Mode.
 */
class AuthService {
    constructor() {
        // Decoupled instantiation of the active provider.
        // Replacement of Clerk with Auth.js/Supabase/Custom only requires changing this line.
        this.provider = new ClerkAuthProvider();
    }

    /**
     * Verifies a session token (JWT) passively.
     * Incorporates a 5-second timeout safeguard to protect performance during provider outages.
     * Returns resolved user { id, email, name } or null (degrading to Guest Mode).
     */
    async verifySessionToken(token) {
        if (!token) return null;

        // Support mock tokens for local development & testing
        if (token.startsWith('mock_token_')) {
            try {
                const parts = token.split('_');
                // Format: mock_token_<email>_<name>
                const email = parts[2] || 'test@example.com';
                const name = parts[3] ? decodeURIComponent(parts[3]) : 'Test User';
                // Use same stable ID formula as the register endpoint in auth.controller.js
                const id = 'mock_user_' + Buffer.from(email.toLowerCase()).toString('hex').substring(0, 16);
                console.log(`[AUTH SERVICE] Resolved mock token for User: ${name} (${email}) → ID: ${id}`);
                return { id, email, name };
            } catch (e) {
                console.error("[AUTH SERVICE] Failed to parse mock token:", e.message);
            }
        }

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Auth provider request timed out")), 5000)
        );

        try {
            const user = await Promise.race([
                this.provider.verifyToken(token),
                timeoutPromise
            ]);
            return user;
        } catch (err) {
            console.error(`[AUTH SERVICE] Passive verification failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Retrieves user details from the active provider with timeout protection.
     */
    async getUserDetails(userId) {
        if (!userId) return null;

        // Support mock users for local development & testing
        if (userId.startsWith('mock_user_')) {
            return {
                id: userId,
                email: 'mock-user@example.com',
                name: 'Mock User'
            };
        }

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Auth provider request timed out")), 5000)
        );

        try {
            return await Promise.race([
                this.provider.getUserDetails(userId),
                timeoutPromise
            ]);
        } catch (err) {
            console.error(`[AUTH SERVICE] Failed to fetch user details: ${err.message}`);
            return null;
        }
    }
}

module.exports = new AuthService();
