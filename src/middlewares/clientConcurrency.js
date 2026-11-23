// One client may have only a few AI requests running at once. Without this, a few slow requests from one person fill
// every shared slot and everybody else gets "temporarily busy". The client is the signed-in user, otherwise the IP,
// the same identity the rate limiters use (they set req.rateLimitKey).
const MAX_PER_CLIENT = 3; // a normal editing session has about three at a time: live check, paragraph hints, one action
const running = new Map();

module.exports = function clientConcurrency(req, res, next) {
    const key = req.rateLimitKey || req.user?.id || req.ip || 'unknown';
    const count = running.get(key) || 0;
    if (count >= MAX_PER_CLIENT) {
        res.setHeader('Retry-After', '2');
        return res.status(429).json({
            success: false,
            error: { message: 'Please wait for your other requests to finish. Your text has not been changed.', code: 'PLEASE_WAIT' },
            retryAfter: 2
        });
    }
    running.set(key, count + 1);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        const left = (running.get(key) || 1) - 1;
        if (left > 0) running.set(key, left); else running.delete(key);
    };
    res.once('close', release); // fires when the response ends or the client goes away
    next();
};
module.exports.MAX_PER_CLIENT = MAX_PER_CLIENT;
