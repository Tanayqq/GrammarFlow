/**
 * AuthProvider interface definition.
 * Any identity provider (Clerk, Auth.js, Supabase Auth, Firebase Auth, etc.)
 * must inherit from this class and implement its methods.
 */
class AuthProvider {
    /**
     * Verifies the provider session token (usually a JWT).
     * @param {string} token - The raw session token
     * @returns {Promise<{ id: string, email: string, name?: string }>} The user details
     */
    async verifyToken(token) {
        throw new Error("AuthProvider.verifyToken must be implemented");
    }

    /**
     * Fetches user metadata from the provider.
     * @param {string} userId - The unique provider user ID
     * @returns {Promise<{ id: string, email: string, name?: string }>} The user details
     */
    async getUserDetails(userId) {
        throw new Error("AuthProvider.getUserDetails must be implemented");
    }
}

module.exports = AuthProvider;
