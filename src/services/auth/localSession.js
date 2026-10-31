const jwt = require('jsonwebtoken');

const prefix = 'gf_session_';
const options = { algorithm: 'HS256', issuer: 'grammarflow', audience: 'grammarflow-web' };

function getSecret() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) {
        const error = new Error('SESSION_SECRET must contain at least 32 bytes.');
        error.status = 503;
        throw error;
    }
    return secret;
}

function issueSession(user) {
    return prefix + jwt.sign({ email: user.email, name: user.name }, getSecret(), {
        ...options, subject: user.id, expiresIn: '24h'
    });
}

function verifySession(token) {
    const claims = jwt.verify(token.slice(prefix.length), getSecret(), {
        algorithms: ['HS256'], issuer: options.issuer, audience: options.audience
    });
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') {
        throw new Error('Invalid session claims');
    }
    return { id: claims.sub, email: claims.email, name: claims.name };
}

module.exports = { prefix, getSecret, issueSession, verifySession };
