const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

/**
 * Clerk authentication provider.
 * Verifies JWT session tokens against Clerk's JSON Web Key Set (JWKS)
 * and retrieves user profiles using Clerk's backend API.
 */
class ClerkAuthProvider {
    constructor() {
        this.jwksUri = process.env.CLERK_JWKS_URI || '';
        this.secretKey = process.env.CLERK_SECRET_KEY || '';
        this.originPolicy = require('../../config/cors');
        this.issuer = process.env.CLERK_ISSUER || '';
        if (!this.issuer && process.env.CLERK_FRONTEND_API) {
            this.issuer = new URL(process.env.CLERK_FRONTEND_API.startsWith('https://') ? process.env.CLERK_FRONTEND_API : `https://${process.env.CLERK_FRONTEND_API}`).origin;
        }
        if (!this.issuer) {
            const key = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
            if (key) {
                try { this.issuer = new URL(`https://${Buffer.from(key.trim().split('_')[2], 'base64').toString('utf8').replace(/\$$/, '')}`).origin; }
                catch (_) { /* An invalid publishable key must not establish an issuer. */ }
            }
        }
        
        // Derive JWKS URI from Clerk Publishable Key or Frontend API if direct URI not set
        if (!this.jwksUri) {
            const frontendApi = process.env.CLERK_FRONTEND_API;
            if (frontendApi) {
                // E.g., https://clerk.example.com/.well-known/jwks.json
                this.jwksUri = `https://${frontendApi.replace(/^https?:\/\//, '')}/.well-known/jwks.json`;
            } else if (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
                try {
                    // Clerk Publishable Keys contain a base64 encoded payload that contains the frontend API URL
                    const rawKey = (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim();
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

        // A development instance has strict user limits and none of the production protections.
        const publishable = (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim();
        if ((process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') && (publishable.startsWith('pk_test_') || this.secretKey.startsWith('sk_test_'))) {
            console.warn('[CLERK AUTH WARNING] Production is using Clerk DEVELOPMENT keys (pk_test_/sk_test_). Create a Clerk production instance and replace CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY and CLERK_ISSUER.');
        }

        // Clerk session tokens usually carry no email or name, so each one needs a profile lookup. Remember the answers.
        this.detailsCache = new Map();
        this.detailsPending = new Map();

        this.client = null;
        if (this.jwksUri) {
            // Instance-hosted JWKS is a safe fallback; the shared API host is not an issuer.
            if (!this.issuer && new URL(this.jwksUri).hostname !== 'api.clerk.com') this.issuer = new URL(this.jwksUri).origin;
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
        if (!this.client || !this.jwksUri || !this.issuer) {
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

            jwt.verify(token, getKey, { algorithms: ['RS256'], issuer: this.issuer }, async (err, decoded) => {
                if (err) {
                    return reject(err);
                }
                if (!decoded || typeof decoded.sub !== 'string' || !decoded.sub || !Number.isFinite(decoded.exp)) {
                    return reject(new Error('Invalid Clerk session claims'));
                }
                // Clerk may omit azp for privacy-related empty Origin requests.
                // When present, require the same explicit application origins as CORS.
                if (decoded.azp !== undefined) {
                    let allowed = false;
                    if (typeof decoded.azp === 'string' && decoded.azp) {
                        this.originPolicy.origin(decoded.azp, (error, value) => { allowed = !error && value; });
                    }
                    if (!allowed) return reject(new Error('Unapproved Clerk authorized party'));
                }
                
                let email = decoded.email || decoded.email_address || null;
                let name = decoded.name || null;
                
                if ((!email || !name) && this.secretKey) {
                    try {
                        const details = await this.cachedUserDetails(decoded.sub);
                        email = details.email || email;
                        name = details.name || name;
                    } catch (e) {
                        console.warn("[CLERK AUTH] Failed to fetch user details dynamically:", e.message);
                    }
                }
                
                resolve({
                    id: decoded.sub,
                    email,
                    name
                });
            });
        });
    }

    // A profile is remembered for 10 minutes (a name or email change shows up after that), a failure for 30 seconds so a
    // Clerk outage or rate limit is not hammered, and callers that arrive during a lookup share it.
    cachedUserDetails(userId) {
        const hit = this.detailsCache.get(userId);
        if (hit && hit.expires > Date.now()) return hit.error ? Promise.reject(hit.error) : Promise.resolve(hit.value);
        if (this.detailsPending.has(userId)) return this.detailsPending.get(userId);
        const remember = entry => {
            if (this.detailsCache.size >= 500) this.detailsCache.delete(this.detailsCache.keys().next().value);
            this.detailsCache.set(userId, entry);
        };
        const request = this.getUserDetails(userId)
            .then(value => { remember({ value, expires: Date.now() + 10 * 60 * 1000 }); return value; },
                error => { remember({ error, expires: Date.now() + 30 * 1000 }); throw error; })
            .finally(() => this.detailsPending.delete(userId));
        this.detailsPending.set(userId, request);
        return request;
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
            },
            signal: AbortSignal.timeout(4000) // a stalled lookup ends, so it cannot hold up callers that share it
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
