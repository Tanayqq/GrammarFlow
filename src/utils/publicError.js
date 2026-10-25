function sendAIError(res, error) {
    const retryAfter = Number.isFinite(error?.retryAfter) ? Math.max(1, Math.ceil(error.retryAfter)) : 30;
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(503).json({
        success: false,
        error: {
            message: 'Writing assistance is temporarily busy. Your text has not been changed. Please try again shortly.',
            code: 'AI_TEMPORARILY_UNAVAILABLE'
        },
        retryAfter
    });
}

module.exports = { sendAIError };
