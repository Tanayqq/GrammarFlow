const { createHash, randomInt, randomBytes } = require('node:crypto');
const { redisConnection } = require('../../queue');

const digest = value => createHash('sha256').update(value).digest('hex');
const otpKey = email => `gf:otp:${digest(email)}`;

function connection() {
    if (redisConnection.status !== 'ready') {
        const error = new Error('Email verification is temporarily unavailable.');
        error.status = 503;
        throw error;
    }
    return redisConnection;
}

async function createChallenge(email) {
    const code = String(randomInt(100000, 1000000));
    const result = await connection().set(otpKey(email), JSON.stringify({ hash: digest(code), attempts: 0 }), 'EX', 300, 'NX');
    if (!result) {
        const error = new Error('A code was already sent. Please wait five minutes before requesting another.');
        error.status = 429;
        throw error;
    }
    return code;
}

async function cancelChallenge(email) {
    await connection().del(otpKey(email));
}

async function verifyChallenge(email, code) {
    const accepted = await connection().eval(`
        local raw = redis.call('GET', KEYS[1])
        if not raw then return 0 end
        local record = cjson.decode(raw)
        if record.hash == ARGV[1] then
            redis.call('DEL', KEYS[1])
            return 1
        end
        record.attempts = record.attempts + 1
        if record.attempts >= 5 then
            redis.call('DEL', KEYS[1])
        else
            redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
        end
        return 0
    `, 1, otpKey(email), digest(code));
    if (!accepted) return null;
    const proof = randomBytes(32).toString('hex');
    await connection().set(`gf:verified:${digest(proof)}`, email, 'EX', 300);
    return proof;
}

async function consumeProof(email, proof) {
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
    return Boolean(await connection().eval(`
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('DEL', KEYS[1])
        return 1
    `, 1, `gf:verified:${digest(proof)}`, email));
}

module.exports = { createChallenge, cancelChallenge, verifyChallenge, consumeProof };
