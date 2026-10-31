const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { aiLimiter, docLimiter, readLimiter } = require('../middlewares/rateLimiter');
const { passiveAuth } = require('../middlewares/auth');
const authRoutes = require('./auth.routes');
const validateAIInput = require('../middlewares/validateAIInput');

router.use('/auth', authRoutes);

router.post('/dev-editor/assist', passiveAuth, aiLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const assistant = require('../../dev-editor-demo/assistant.cjs');
    try {
        assistant.requestFor(req.body);
    } catch {
        return res.status(400).json({success:false,error:{message:'Use a valid Python explanation request with at most 12,000 characters.'}});
    }
    const result = await assistant.assist(req.body, {localAdmission:false});
    return res.status(result.status).json(result.body);
});

// All AI operation routes include passiveAuth so req.userId is set when user is logged in.
// This ensures history is saved under the user's account, not just guest_session_id.
router.post('/rewrite',          passiveAuth, validateAIInput, aiLimiter, aiController.rewrite);
router.post('/grammar-fix',      passiveAuth, validateAIInput, aiLimiter, aiController.grammarFix);
router.post('/suggestions',      passiveAuth, validateAIInput, aiLimiter, aiController.suggestions);
router.post('/autocomplete',     passiveAuth, validateAIInput, aiLimiter, aiController.autocomplete);
router.post('/analyze-realtime', passiveAuth, validateAIInput, aiLimiter, aiController.analyzeRealtime);       // Phase 3 (sentence-level)
router.post('/analyze-smart',    passiveAuth, validateAIInput, aiLimiter, aiController.analyzeSmartSuggestions);  // Phase 4 (paragraph-level)
router.post('/process-document', passiveAuth, validateAIInput, docLimiter, aiController.processDocument);       // Phase 6 (Document/Image)

router.get('/job/:jobId',    passiveAuth, readLimiter, aiController.checkJobStatus);   // Poll job status (GET)
router.post('/job/:jobId',   passiveAuth, readLimiter, aiController.checkJobStatus);   // Poll job status (POST - extension support)
router.get('/history',       passiveAuth, readLimiter, aiController.getHistory);        // History (auth-aware)
router.get('/history/:id',   passiveAuth, readLimiter, aiController.getHistoryDetail); // Detail (auth-aware)
router.delete('/history/:id', passiveAuth, readLimiter, aiController.deleteHistory);   // Delete (auth-aware)

module.exports = router;
