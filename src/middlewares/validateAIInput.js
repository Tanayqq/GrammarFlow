const { EXTENSION_ACTIONS } = require('../config/prompts');

// Reject malformed requests before cache lookup, rate accounting or provider work.
module.exports = function validateAIInput(req, res, next) {
    const fail = (message, status = 400) => res.status(status).json({ success: false, error: { message } });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('A JSON object is required');
    const field = req.path === '/autocomplete' ? 'context' : 'text';
    if (typeof body[field] !== 'string') return fail(`${field} must be a string`);
    if (body[field].length > 50000) return fail(`${field} exceeds the 50,000-character limit`, 413);
    if (!['/analyze-realtime', '/analyze-smart'].includes(req.path) && !body[field].trim()) {
        return fail(`${field} is required`);
    }
    if (body.voiceSample !== undefined && (typeof body.voiceSample !== 'string' || body.voiceSample.length > 3000)) {
        return fail('voiceSample must be a string of at most 3,000 characters');
    }
    for (const key of ['language', 'style', 'tone', 'mode', 'partial_word']) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 20000)) {
            return fail(`${key} must be a string of at most 20,000 characters`);
        }
    }
    // Client-supplied system prompts are no longer accepted; callers pick an action instead.
    if (body.extensionAction !== undefined && !EXTENSION_ACTIONS.includes(body.extensionAction)) {
        return fail(`extensionAction must be one of: ${EXTENSION_ACTIONS.join(', ')}`);
    }
    for (const key of ['humanize', 'learningMode', 'isConsolidation']) {
        if (body[key] !== undefined && typeof body[key] !== 'boolean') return fail(`${key} must be a boolean`);
    }
    if (body.writingContext !== undefined && (!body.writingContext || typeof body.writingContext !== 'object' || Array.isArray(body.writingContext))) {
        return fail('writingContext must be an object');
    }
    next();
};
