const { createHash, randomInt, randomBytes } = require('node:crypto');
const { redisConnection } = require('../../queue');

const digest = value => createHash('sha256').update(value).digest('hex');
const otpKey = email => `gf:otp:${digest(email)}`;

function connection() {
    if (redisConnection.status !== 'ready') {
        const error = new Error('Email verification is temporarily unavailable.');
        error.status = 503;
        error.expose = true;
        throw error;
    }
    return redisConnection;
}

const alreadySent = () => {
    const error = new Error('A code was already sent. Please wait five minutes before requesting another.');
    error.status = 429;
    error.expose = true;
    return error;
};

// The pause between sends has its own key, separate from the code. Deleting or using up a code (five wrong guesses,
// a correct one) must never allow an early re-send, or the pause would differ for registered and unregistered emails
// and show which is which.
const sendKey = email => `gf:otpsend:${digest(email)}`;
async function reserveSend(email) {
    if (!await connection().set(sendKey(email), '1', 'EX', 300, 'NX')) throw alreadySent();
}

async function createChallenge(email) {
    await reserveSend(email);
    const code = String(randomInt(100000, 1000000));
    try {
        await connection().set(otpKey(email), JSON.stringify({ hash: digest(code), attempts: 0 }), 'EX', 300);
    } catch (error) {
        await connection().del(sendKey(email)).catch(() => {}); // no code was stored, so do not make the person wait
        throw error;
    }
    return code;
}

// An email that already has an account gets a notice instead of a code, under the same pause.
const reserveNotice = reserveSend;
async function cancelNotice(email) {
    await connection().del(sendKey(email));
}

async function cancelChallenge(email) {
    await connection().del(otpKey(email), sendKey(email)); // delivery failed: the person may try again at once
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

// Looks at a proof without spending it, so a registration that fails for another reason can be retried.
async function peekProof(email, proof) {
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
    return await connection().get(`gf:verified:${digest(proof)}`) === email;
}

async function consumeProof(email, proof) {
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
    return Boolean(await connection().eval(`
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('DEL', KEYS[1])
        return 1
    `, 1, `gf:verified:${digest(proof)}`, email));
}

module.exports = { createChallenge, cancelChallenge, reserveNotice, cancelNotice, peekProof, verifyChallenge, consumeProof };
