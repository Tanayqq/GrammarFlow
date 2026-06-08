const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const AuthProvider = require('./AuthProvider');

/**
 * Clerk concrete implementation of AuthProvider.
 * Verifies JWT session tokens against Clerk's JSON Web Key Set (JWKS)
 * and retrieves user profiles using Clerk's backend API.
 */
class ClerkAuthProvider extends AuthProvider {
    constructor() {
        super();
        this.jwksUri = process.env.CLERK_JWKS_URI || '';
        this.secretKey = process.env.CLERK_SECRET_KEY || '';
        
        // Derive JWKS URI from Clerk Publishable Key or Frontend API if direct URI not set
        if (!this.jwksUri) {
            const frontendApi = process.env.CLERK_FRONTEND_API;
            if (frontendApi) {
                // E.g., https://clerk.example.com/.well-known/jwks.json
                this.jwksUri = `https://${frontendApi.replace(/^https?:\/\//, '')}/.well-known/jwks.json`;
            } else if (process.env.CLERK_PUBLISHABLE_KEY) {
                try {
                    // Clerk Publishable Keys contain a base64 encoded payload that contains the frontend API URL
                    const rawKey = process.env.CLERK_PUBLISHABLE_KEY;
                    const encodedPayload = rawKey.split('_')[2];
                    if (encodedPayload) {
                        const decoded = Buffer.from(encodedPayload, 'base64').toString('utf-8');
                        // Usually matches something like "clerk.unique-id.lcl.dev$"
                        const frontendUrl = decoded.replace(/\$$/, '');
                        this.jwksUri = `https://${frontendUrl}/.well-known/jwks.json`;
                    }
                } catch (e) {
                    console.error("[CLERK AUTH WARNING] Failed to parse CLERK_PUBLISHABLE_KEY for JWKS URI derivation:", e.message);
                }
            }
        }

        this.client = null;
        if (this.jwksUri) {
            this.client = jwksClient({
                jwksUri: this.jwksUri,
                cache: true,
                rateLimit: true,
                jwksRequestsPerMinute: 10
            });
            console.log(`[CLERK AUTH] Initialized with JWKS URI: ${this.jwksUri}`);
        } else {
            console.warn("[CLERK AUTH WARNING] Clerk credentials (CLERK_JWKS_URI, CLERK_FRONTEND_API, or CLERK_PUBLISHABLE_KEY) are not set. Auth verification will fail back to Guest Mode.");
        }
    }

    /**
     * Verifies the Clerk session token JWT.
     */
    async verifyToken(token) {
        if (!this.client || !this.jwksUri) {
            throw new Error("Clerk is not configured. Missing JWKS URI configuration.");
        }

        return new Promise((resolve, reject) => {
            const getKey = (header, callback) => {
                this.client.getSigningKey(header.kid, (err, key) => {
                    if (err) {
                        return callback(err);
                    }
                    const signingKey = key.getPublicKey();
                    callback(null, signingKey);
                });
            };

            jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
                if (err) {
                    return reject(err);
                }
                
                // Resolve user claims from decoded token
                resolve({
                    id: decoded.sub,
                    email: decoded.email || decoded.email_address || null,
                    name: decoded.name || null
                });
            });
        });
    }

    /**
     * Fetches user metadata using Clerk Backend API.
     */
    async getUserDetails(userId) {
        if (!this.secretKey) {
            throw new Error("Clerk Backend API calls require CLERK_SECRET_KEY configuration.");
        }

        const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
            headers: {
                'Authorization': `Bearer ${this.secretKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Clerk Backend API returned status ${response.status}`);
        }

        const data = await response.json();
        
        // Find primary email
        const emailObj = data.email_addresses?.find(e => e.id === data.primary_email_address_id) || data.email_addresses?.[0];
        
        return {
            id: data.id,
            email: emailObj ? emailObj.email_address : null,
            name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || null
        };
    }
}

module.exports = ClerkAuthProvider;
