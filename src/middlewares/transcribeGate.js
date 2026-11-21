// Each dictation upload is held in memory (up to 5 MB, plus a copy for Groq). Refuse extra
// uploads *before* express.raw reads their bodies, so a burst cannot exhaust a small instance.
const MAX_ACTIVE = 3;
let active = 0;

module.exports = function transcribeGate(req, res, next) {
    if (active >= MAX_ACTIVE) {
        res.set('Retry-After', '10');
        return res.status(503).json({ success: false, error: { message: 'Dictation is busy. Please try again in a few seconds.', code: 'AI_TEMPORARILY_UNAVAILABLE' } });
    }
    active++;
    res.once('close', () => { active--; });
    next();
};
