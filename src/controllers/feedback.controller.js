const KINDS = ['confusing', 'broken', 'idea', 'other'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });

const submitFeedback = async (req, res) => {
    const { kind, message, email = '', website = '' } = req.body || {};
    // "website" is a field people never see. Only form-filling bots complete it: answer as usual and keep nothing.
    if (website) return res.status(201).json({ success: true });

    if (!KINDS.includes(kind)) return fail(res, 400, 'Choose what your feedback is about.');
    if (typeof message !== 'string' || message.trim().length < 3) return fail(res, 400, 'Please write a few words about what happened.');
    if (message.length > 2000) return fail(res, 400, 'Please keep your message under 2,000 characters.');
    if (typeof email !== 'string' || email.length > 254 || (email.trim() && !EMAIL.test(email.trim()))) {
        return fail(res, 400, 'Check the email address, or leave it empty.');
    }

    try {
        // required here so a missing database setting cannot stop the server from starting
        await require('../db').feedback.create({
            data: { kind, message: message.trim().replace(/\u0000/g, ''), email: email.trim() || null }
        });
        return res.status(201).json({ success: true });
    } catch (err) {
        // the message and the address are private: log only what kind of failure it was
        console.error('[FEEDBACK] Could not save feedback:', err.code || err.name);
        return fail(res, 503, 'We could not save your feedback just now. Your text is still here, so please try again in a few minutes.');
    }
};

module.exports = { submitFeedback, KINDS };
